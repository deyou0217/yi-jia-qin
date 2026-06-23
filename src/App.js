import { defineComponent, ref, reactive, computed, onMounted, onBeforeUnmount, nextTick } from 'https://unpkg.com/vue@3.4.21/dist/vue.esm-browser.js'
import LoginView from './components/LoginView.js'
import ChatView from './components/ChatView.js'
import VideoView from './components/VideoView.js'
import FileNotifyModal from './components/FileNotifyModal.js'
import { deriveKey, generateRoomId } from './utils/crypto.js'
import { FamilyRoom } from './utils/p2p.js'

export default defineComponent({
  name: 'App',
  components: { LoginView, ChatView, VideoView, FileNotifyModal },

  setup() {
    // 视图状态：login | lobby | chat | video
    const view = ref('login')
    const roomId = ref('')
    const nickname = ref('')
    const cryptoKey = ref(null)
    const room = ref(null)
    const myPeerId = ref('')
    const members = reactive([]) // { peerId, nickname, online }
    const messages = reactive([])
    const inCallStream = ref(null)
    const remoteStreams = reactive({}) // peerId -> MediaStream
    const fileNotify = reactive({ show: false, meta: null, buffer: null, fromPeerId: '', onAccept: null, onReject: null })
    const statusMsg = ref('')
    const errorMsg = ref('')
    const isConnecting = ref(false)

    // ── 登录逻辑 ──────────────────────────────
    async function handleLogin({ roomIdVal, passwordVal, nicknameVal }) {
      errorMsg.value = ''
      if (!roomIdVal || !passwordVal || !nicknameVal) {
        errorMsg.value = '请填写完整信息'
        return
      }
      isConnecting.value = true
      statusMsg.value = '正在派生加密密钥…'
      try {
        const key = await deriveKey(roomIdVal, passwordVal)
        cryptoKey.value = key
        roomId.value = roomIdVal
        nickname.value = nicknameVal

        statusMsg.value = '正在连接 P2P 网络…'
        const r = new FamilyRoom({
          roomId: roomIdVal,
          nickname: nicknameVal,
          cryptoKey: key,
          onReady(peerId) {
            myPeerId.value = peerId
            statusMsg.value = '已连接，等待家人加入…'
            isConnecting.value = false
            view.value = 'chat'
          },
          onMemberJoin(info) {
            // 防重复
            if (!members.find(m => m.peerId === info.peerId)) {
              members.push({ peerId: info.peerId, nickname: info.nickname, online: true })
            }
            addSystemMsg(`${info.nickname} 加入了家庭房间 🏠`)
          },
          onMemberLeave(peerId) {
            const idx = members.findIndex(m => m.peerId === peerId)
            if (idx !== -1) {
              addSystemMsg(`${members[idx].nickname} 离开了房间`)
              members.splice(idx, 1)
            }
            // 关闭其视频流
            delete remoteStreams[peerId]
          },
          onMessage(msgObj) {
            messages.push({
              id: Date.now() + Math.random(),
              type: 'chat',
              ...msgObj
            })
          },
          onFileReceived(evt) {
            if (evt.type === 'incoming') {
              // 弹出提示框，等待用户决定
              fileNotify.show = true
              fileNotify.meta = evt.meta
              fileNotify.fromPeerId = evt.fromPeerId
              fileNotify.buffer = null
            } else if (evt.type === 'complete') {
              if (fileNotify.show && fileNotify.meta?.fileId === evt.meta?.fileId) {
                fileNotify.buffer = evt.buffer
                if (fileNotify.onAccept) fileNotify.onAccept(evt.buffer)
              }
              // 否则用户已拒绝，直接GC
            }
          },
          onRemoteStream({ peerId, stream }) {
            remoteStreams[peerId] = stream
          },
          onRemoteStreamClose(peerId) {
            delete remoteStreams[peerId]
          },
          onError(err) {
            errorMsg.value = `连接错误: ${err.type || err.message}`
            isConnecting.value = false
          }
        })

        room.value = r
        await r.init()
      } catch (e) {
        errorMsg.value = `初始化失败: ${e.message}`
        isConnecting.value = false
      }
    }

    function addSystemMsg(text) {
      messages.push({
        id: Date.now() + Math.random(),
        type: 'system',
        text
      })
    }

    // ── 聊天逻辑 ──────────────────────────────
    async function sendMessage(text) {
      if (!room.value || !text.trim()) return
      const msg = await room.value.broadcastMessage(text)
      messages.push({
        id: Date.now() + Math.random(),
        type: 'chat',
        self: true,
        nickname: nickname.value,
        text: msg.text,
        time: msg.time
      })
    }

    // ── 连接已知成员 ──────────────────────────
    function connectMember(targetPeerId) {
      if (room.value) room.value.connectToPeer(targetPeerId)
    }

    // ── 音视频逻辑 ──────────────────────────────
    async function startCall() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, frameRate: 24 },
          audio: { echoCancellation: true, noiseSuppression: true }
        })
        inCallStream.value = stream
        await room.value.startVideoCall(stream)
        view.value = 'video'
      } catch (e) {
        errorMsg.value = `无法获取摄像头: ${e.message}`
      }
    }

    function endCall() {
      if (room.value) room.value.stopVideoCall()
      inCallStream.value = null
      view.value = 'chat'
    }

    // ── 文件发送 ──────────────────────────────
    async function sendFile(targetPeerId, file, onProgress) {
      if (!room.value) return
      await room.value.sendFile(targetPeerId, file, onProgress)
    }

    // ── 文件接收处理 ──────────────────────────
    function handleFileAccept(buffer, meta) {
      // 用户同意保存 → 调用系统原生"另存为"
      const blob = new Blob([buffer], { type: meta.mimeType || 'application/octet-stream' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = meta.name
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 5000)
      fileNotify.show = false
      fileNotify.buffer = null
    }

    function handleFileReject() {
      // 拒绝：buffer直接被GC，不写磁盘
      fileNotify.show = false
      fileNotify.buffer = null
    }

    // ── 退出房间 ──────────────────────────────
    async function leaveRoom() {
      if (room.value) {
        await room.value.leave()
        room.value = null
      }
      members.splice(0)
      messages.splice(0)
      inCallStream.value = null
      Object.keys(remoteStreams).forEach(k => delete remoteStreams[k])
      view.value = 'login'
      statusMsg.value = ''
    }

    onBeforeUnmount(() => {
      if (room.value) room.value.leave()
    })

    return {
      view, roomId, nickname, myPeerId,
      members, messages, inCallStream, remoteStreams,
      fileNotify, statusMsg, errorMsg, isConnecting,
      handleLogin, sendMessage, connectMember,
      startCall, endCall, sendFile,
      handleFileAccept, handleFileReject, leaveRoom,
      generateRoomId
    }
  },

  template: `
    <div class="app-root">
      <LoginView
        v-if="view === 'login'"
        :error="errorMsg"
        :loading="isConnecting"
        :status="statusMsg"
        @login="handleLogin"
        @generate-id="() => {}"
      />
      <ChatView
        v-else-if="view === 'chat'"
        :my-peer-id="myPeerId"
        :room-id="roomId"
        :nickname="nickname"
        :members="members"
        :messages="messages"
        @send-message="sendMessage"
        @connect-member="connectMember"
        @start-call="startCall"
        @send-file="sendFile"
        @leave="leaveRoom"
      />
      <VideoView
        v-else-if="view === 'video'"
        :local-stream="inCallStream"
        :remote-streams="remoteStreams"
        :members="members"
        :nickname="nickname"
        @end-call="endCall"
      />
      <FileNotifyModal
        v-if="fileNotify.show"
        :meta="fileNotify.meta"
        @accept="(buf) => handleFileAccept(buf, fileNotify.meta)"
        @reject="handleFileReject"
      />
    </div>
  `
})
