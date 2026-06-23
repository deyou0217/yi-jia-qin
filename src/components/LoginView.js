import { defineComponent, ref } from 'https://unpkg.com/vue@3.4.21/dist/vue.esm-browser.js'
import { generateRoomId } from '../utils/crypto.js'

export default defineComponent({
  name: 'LoginView',
  props: {
    error: String,
    loading: Boolean,
    status: String
  },
  emits: ['login'],
  setup(props, { emit }) {
    const roomId = ref('')
    const password = ref('')
    const nickname = ref('')
    const showPwd = ref(false)
    const mode = ref('join') // join | create

    function autoGenRoom() {
      roomId.value = generateRoomId()
    }

    function submit() {
      emit('login', {
        roomIdVal: roomId.value.trim().toUpperCase(),
        passwordVal: password.value,
        nicknameVal: nickname.value.trim()
      })
    }

    return { roomId, password, nickname, showPwd, mode, autoGenRoom, submit }
  },
  template: `
    <div class="login-page">
      <div class="login-hero">
        <div class="hero-icon">🏠</div>
        <h1 class="hero-title">一家亲</h1>
        <p class="hero-sub">无服务器 · 纯P2P · 端对端加密 · 完全私密</p>
      </div>

      <div class="login-card">
        <div class="tab-row">
          <button :class="['tab-btn', mode==='join' && 'active']" @click="mode='join'">加入房间</button>
          <button :class="['tab-btn', mode==='create' && 'active']" @click="mode='create'; autoGenRoom()">创建房间</button>
        </div>

        <div class="field-group">
          <label class="field-label">家庭房间号</label>
          <div class="field-row">
            <input
              v-model="roomId"
              class="field-input"
              :placeholder="mode==='create' ? '已自动生成，可修改' : '输入家人分享的房间号'"
              maxlength="10"
              style="text-transform:uppercase;letter-spacing:3px;font-weight:700"
            />
            <button v-if="mode==='create'" class="gen-btn" @click="autoGenRoom" title="重新生成">🔄</button>
          </div>
        </div>

        <div class="field-group">
          <label class="field-label">房间密码</label>
          <div class="field-row">
            <input
              v-model="password"
              class="field-input"
              :type="showPwd ? 'text' : 'password'"
              placeholder="只有知道密码才能加入"
              @keyup.enter="submit"
            />
            <button class="gen-btn" @click="showPwd=!showPwd">{{ showPwd ? '👁️' : '🔒' }}</button>
          </div>
        </div>

        <div class="field-group">
          <label class="field-label">我的昵称</label>
          <input
            v-model="nickname"
            class="field-input"
            placeholder="如：爸爸、妈妈、宝贝"
            maxlength="12"
            @keyup.enter="submit"
          />
        </div>

        <div v-if="props.error" class="error-banner">⚠️ {{ props.error }}</div>
        <div v-if="props.loading" class="status-banner">
          <span class="spinner"></span> {{ props.status || '连接中…' }}
        </div>

        <button
          class="login-btn"
          :disabled="props.loading"
          @click="submit"
        >
          <span v-if="props.loading">连接中…</span>
          <span v-else>{{ mode === 'create' ? '🏠 创建并进入' : '🚪 加入家庭' }}</span>
        </button>

        <div class="privacy-note">
          <span>🔐</span>
          <span>密码通过 PBKDF2 本地派生，数据全程 AES-256-GCM 加密，无服务器，无账号，断网即销毁</span>
        </div>
      </div>
    </div>
  `
})
