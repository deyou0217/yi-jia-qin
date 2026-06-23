import { defineComponent, ref, computed } from 'https://unpkg.com/vue@3.4.21/dist/vue.esm-browser.js'

export default defineComponent({
  name: 'FileNotifyModal',
  props: {
    meta: Object
  },
  emits: ['accept', 'reject'],
  setup(props, { emit }) {
    const previewUrl = ref(null)
    const fileReceived = ref(false)

    // 格式化文件大小
    function fmtSize(bytes) {
      if (!bytes) return ''
      if (bytes < 1024) return bytes + ' B'
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
      return (bytes / 1024 / 1024).toFixed(2) + ' MB'
    }

    function fileIcon(mime) {
      if (!mime) return '📄'
      if (mime.startsWith('image/')) return '🖼️'
      if (mime.startsWith('video/')) return '🎬'
      if (mime.startsWith('audio/')) return '🎵'
      if (mime.includes('pdf')) return '📑'
      if (mime.includes('zip') || mime.includes('rar')) return '🗜️'
      return '📄'
    }

    function reject() {
      emit('reject')
    }

    function accept() {
      // 触发父组件处理（父组件等待 buffer 到达后保存）
      emit('accept', null)
    }

    return { previewUrl, fileReceived, fmtSize, fileIcon, reject, accept }
  },
  template: `
    <div class="modal-overlay" @click.self="reject">
      <div class="modal-card file-modal">
        <div class="modal-icon">{{ fileIcon(meta?.mimeType) }}</div>
        <div class="modal-title">收到文件</div>
        <div class="file-sender">来自：<strong>{{ meta?.sender || '家庭成员' }}</strong></div>
        <div class="file-name">{{ meta?.name }}</div>
        <div class="file-size">{{ fmtSize(meta?.size) }}</div>
        <div class="modal-notice">⚡ 文件仅在内存中，拒绝或关闭后立即销毁，不会写入磁盘</div>
        <div class="modal-actions">
          <button class="modal-btn reject-btn" @click="reject">❌ 拒绝</button>
          <button class="modal-btn accept-btn" @click="accept">✅ 同意并保存</button>
        </div>
      </div>
    </div>
  `
})
