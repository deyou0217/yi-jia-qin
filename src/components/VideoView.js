import { defineComponent, ref, onMounted, onBeforeUnmount, watch, computed } from 'https://unpkg.com/vue@3.4.21/dist/vue.esm-browser.js'

export default defineComponent({
  name: 'VideoView',
  props: {
    localStream: Object,
    remoteStreams: Object,
    members: Array,
    nickname: String
  },
  emits: ['end-call'],
  setup(props, { emit }) {
    const localVideoRef = ref(null)
    const micMuted = ref(false)
    const camOff = ref(false)
    const callDuration = ref(0)
    let timer = null

    onMounted(() => {
      bindLocalStream()
      timer = setInterval(() => { callDuration.value++ }, 1000)
    })

    onBeforeUnmount(() => {
      if (timer) clearInterval(timer)
    })

    watch(() => props.localStream, () => bindLocalStream())

    function bindLocalStream() {
      if (localVideoRef.value && props.localStream) {
        localVideoRef.value.srcObject = props.localStream
      }
    }

    function bindRemoteStream(el, stream) {
      if (el && stream) el.srcObject = stream
    }

    function toggleMic() {
      if (!props.localStream) return
      props.localStream.getAudioTracks().forEach(t => {
        t.enabled = !t.enabled
      })
      micMuted.value = !micMuted.value
    }

    function toggleCam() {
      if (!props.localStream) return
      props.localStream.getVideoTracks().forEach(t => {
        t.enabled = !t.enabled
      })
      camOff.value = !camOff.value
    }

    function formatDuration(s) {
      const m = Math.floor(s / 60).toString().padStart(2, '0')
      const sec = (s % 60).toString().padStart(2, '0')
      return `${m}:${sec}`
    }

    const remoteEntries = computed(() => {
      return Object.entries(props.remoteStreams || {})
    })

    function getMemberName(peerId) {
      const m = props.members?.find(x => x.peerId === peerId)
      return m?.nickname || peerId.slice(-6)
    }

    return {
      localVideoRef, micMuted, camOff, callDuration,
      bindRemoteStream, toggleMic, toggleCam, formatDuration,
      remoteEntries, getMemberName
    }
  },
  template: `
    <div class="video-page">
      <!-- 远程视频网格 -->
      <div :class="['video-grid', 'count-' + remoteEntries.length]">
        <div v-if="remoteEntries.length === 0" class="waiting-call">
          <div class="waiting-icon">📹</div>
          <div>等待家人接听…</div>
        </div>
        <div v-for="[peerId, stream] in remoteEntries" :key="peerId" class="remote-video-cell">
          <video
            autoplay playsinline
            :ref="el => bindRemoteStream(el, stream)"
            class="remote-video"
          ></video>
          <div class="video-name-tag">{{ getMemberName(peerId) }}</div>
        </div>
      </div>

      <!-- 本地小窗 -->
      <div class="local-preview">
        <video
          ref="localVideoRef"
          autoplay playsinline muted
          class="local-video"
          :class="{ 'cam-off': camOff }"
        ></video>
        <div class="local-name">{{ nickname }}（我）</div>
      </div>

      <!-- 控制栏 -->
      <div class="call-controls">
        <div class="call-timer">{{ formatDuration(callDuration) }}</div>
        <div class="ctrl-buttons">
          <button
            :class="['ctrl-btn', micMuted && 'muted']"
            @click="toggleMic"
            :title="micMuted ? '取消静音' : '静音'"
          >
            {{ micMuted ? '🔇' : '🎙️' }}
          </button>
          <button
            class="ctrl-btn end-call"
            @click="$emit('end-call')"
            title="挂断"
          >📵</button>
          <button
            :class="['ctrl-btn', camOff && 'muted']"
            @click="toggleCam"
            :title="camOff ? '开启摄像头' : '关闭摄像头'"
          >
            {{ camOff ? '📷' : '📸' }}
          </button>
        </div>
        <div class="e2e-tag">🔐 端对端加密</div>
      </div>
    </div>
  `
})
