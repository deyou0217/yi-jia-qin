import { defineComponent, ref, reactive, nextTick, computed } from 'https://unpkg.com/vue@3.4.21/dist/vue.esm-browser.js'

export default defineComponent({
  name: 'ChatView',
  props: {
    myPeerId: String,
    roomId: String,
    nickname: String,
    members: Array,
    messages: Array
  },
  emits: ['send-message', 'connect-member', 'start-call', 'send-file', 'leave'],
  setup(props, { emit }) {
    const inputText = ref('')
    const connectInput = ref('')
    const showConnectPanel = ref(false)
    const showMemberPanel = ref(false)
    const fileProgress = reactive({}) // peerId -> progress%
    const msgListRef = ref(null)

    function sendMsg() {
      if (!inputText.value.trim()) return
      emit('send-message', inputText.value.trim())
      inputText.value = ''
      nextTick(() => scrollBottom())
    }

    function scrollBottom() {
      if (msgListRef.value) {
        msgListRef.value.scrollTop = msgListRef.value.scrollHeight
      }
    }

    function connectPeer() {
      if (!connectInput.value.trim()) return
      emit('connect-member', connectInput.value.trim())
      connectInput.value = ''
      showConnectPanel.value = false
    }

    async function pickFile(targetPeerId) {
      const input = document.createElement('input')
      input.type = 'file'
      input.onchange = async (e) => {
        const file = e.target.files[0]
        if (!file) return
        fileProgress[targetPeerId] = 0
        emit('send-file', targetPeerId, file, (pct) => {
          fileProgress[targetPeerId] = pct
          if (pct === 100) setTimeout(() => delete fileProgress[targetPeerId], 2000)
        })
      }
      input.click()
    }

    function formatTime(ts) {
      return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    }

    return {
      inputText, connectInput, showConnectPanel, showMemberPanel,
      fileProgress, msgListRef,
      sendMsg, connectPeer, pickFile, formatTime
    }
  },
  template: `
    <div class="chat-page">
      <!-- 顶栏 -->
      <div class="chat-header">
        <div class="header-left">
          <button class="icon-btn" @click="showMemberPanel=!showMemberPanel" title="成员列表">👨‍👩‍👧‍👦</button>
          <div>
            <div class="room-title">🏠 {{ roomId }}</div>
            <div class="room-sub">{{ members.length }} 位家人在线</div>
          </div>
        </div>
        <div class="header-right">
          <button class="icon-btn green" @click="$emit('start-call')" title="视频通话">📹</button>
          <button class="icon-btn" @click="showConnectPanel=!showConnectPanel" title="连接成员">➕</button>
          <button class="icon-btn red" @click="$emit('leave')" title="离开房间">🚪</button>
        </div>
      </div>

      <!-- 成员侧栏 -->
      <div v-if="showMemberPanel" class="member-panel">
        <div class="panel-title">家庭成员 ({{ members.length }})</div>
        <div class="member-item self-member">
          <span class="member-dot online"></span>
          <span>{{ nickname }}（我）</span>
        </div>
        <div v-for="m in members" :key="m.peerId" class="member-item">
          <span :class="['member-dot', m.online ? 'online' : 'offline']"></span>
          <span class="member-name">{{ m.nickname }}</span>
          <button class="mini-btn" @click="pickFile(m.peerId)" title="发送文件">📎</button>
          <div v-if="fileProgress[m.peerId] !== undefined" class="progress-bar">
            <div class="progress-fill" :style="{width: fileProgress[m.peerId]+'%'}"></div>
            <span class="progress-text">{{ fileProgress[m.peerId] }}%</span>
          </div>
        </div>
        <div v-if="members.length === 0" class="empty-tip">暂无其他成员<br/>分享房间号邀请家人</div>
        <div class="my-id-box">
          <div class="my-id-label">我的节点ID（分享给家人）：</div>
          <div class="my-id-value" @click="copyId">{{ myPeerId }}</div>
          <div class="copy-hint">点击复制</div>
        </div>
      </div>

      <!-- 连接面板 -->
      <div v-if="showConnectPanel" class="connect-panel">
        <div class="panel-title">连接家庭成员</div>
        <p class="panel-desc">请让对方告知他/她的节点ID，粘贴到下方：</p>
        <div class="field-row">
          <input v-model="connectInput" class="field-input" placeholder="粘贴节点ID" @keyup.enter="connectPeer" />
          <button class="login-btn small" @click="connectPeer">连接</button>
        </div>
        <button class="close-btn" @click="showConnectPanel=false">关闭</button>
      </div>

      <!-- 消息列表 -->
      <div class="msg-list" ref="msgListRef">
        <div v-if="messages.length === 0" class="empty-chat">
          <div class="empty-icon">💬</div>
          <div>房间已就绪，等待家人连接</div>
          <div class="empty-sub">所有消息均在设备间直接传输，不经过任何服务器</div>
        </div>
        <div
          v-for="msg in messages"
          :key="msg.id"
          :class="['msg-item', msg.type === 'system' ? 'system-msg' : (msg.self ? 'self-msg' : 'other-msg')]"
        >
          <template v-if="msg.type === 'system'">
            <span class="system-text">{{ msg.text }}</span>
          </template>
          <template v-else>
            <div class="msg-bubble-wrap">
              <div v-if="!msg.self" class="msg-sender">{{ msg.nickname }}</div>
              <div class="msg-bubble">{{ msg.text }}</div>
              <div class="msg-time">{{ formatTime(msg.time) }}</div>
            </div>
          </template>
        </div>
      </div>

      <!-- 输入栏 -->
      <div class="input-bar">
        <input
          v-model="inputText"
          class="msg-input"
          placeholder="说点什么…（加密传输）"
          @keyup.enter="sendMsg"
          maxlength="500"
        />
        <button class="send-btn" @click="sendMsg" :disabled="!inputText.trim()">发送</button>
      </div>
    </div>
  `,
  methods: {
    copyId() {
      navigator.clipboard?.writeText(this.myPeerId).then(() => {
        alert('节点ID已复制！')
      })
    }
  }
})
