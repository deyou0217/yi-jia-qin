/**
 * P2P 通信核心模块
 * 基于 PeerJS (WebRTC) 实现 Mesh 网络
 * 信令服务器仅用于 ICE 候选交换，不传输任何业务数据
 */

import { encryptMessage, decryptMessage, encryptBuffer, decryptBuffer } from './crypto.js'

// 公共 PeerJS 信令服务器列表（仅用于连接建立，不存储任何数据）
const PEER_CONFIG = {
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:global.stun.twilio.com:3478' }
    ]
  }
}

export class FamilyRoom {
  constructor(options = {}) {
    this.peer = null
    this.roomId = options.roomId || ''
    this.nickname = options.nickname || '家庭成员'
    this.cryptoKey = options.cryptoKey || null
    this.connections = new Map()   // peerId -> DataConnection
    this.mediaConnections = new Map() // peerId -> MediaConnection
    this.localStream = null
    this.myPeerId = null

    // 回调函数
    this.onMemberJoin = options.onMemberJoin || (() => {})
    this.onMemberLeave = options.onMemberLeave || (() => {})
    this.onMessage = options.onMessage || (() => {})
    this.onFileReceived = options.onFileReceived || (() => {})
    this.onRemoteStream = options.onRemoteStream || (() => {})
    this.onRemoteStreamClose = options.onRemoteStreamClose || (() => {})
    this.onError = options.onError || (() => {})
    this.onReady = options.onReady || (() => {})

    // 文件接收缓冲
    this._fileBuffers = new Map()
  }

  /**
   * 初始化本地 Peer，加入房间
   * peerId 格式：roomId-随机字符串，方便同房间成员发现彼此
   */
  async init() {
    return new Promise((resolve, reject) => {
      // 动态加载 PeerJS（CDN方式，避免打包体积过大）
      this._loadPeerJS().then(() => {
        const shortId = Math.random().toString(36).slice(2, 8)
        this.myPeerId = `yjq-${this.roomId}-${shortId}`

        this.peer = new Peer(this.myPeerId, PEER_CONFIG)

        this.peer.on('open', (id) => {
          console.log('[P2P] 本地节点就绪:', id)
          this.onReady(id)
          resolve(id)
        })

        this.peer.on('connection', (conn) => {
          this._handleIncomingConnection(conn)
        })

        this.peer.on('call', (call) => {
          this._handleIncomingCall(call)
        })

        this.peer.on('error', (err) => {
          console.error('[P2P] 错误:', err)
          this.onError(err)
          reject(err)
        })
      })
    })
  }

  /**
   * 动态加载 PeerJS
   */
  _loadPeerJS() {
    return new Promise((resolve) => {
      if (window.Peer) { resolve(); return }
      const script = document.createElement('script')
      script.src = 'https://unpkg.com/peerjs@1.5.2/dist/peerjs.min.js'
      script.onload = resolve
      document.head.appendChild(script)
    })
  }

  /**
   * 连接到另一个成员（主动发起）
   * @param {string} targetPeerId
   */
  connectToPeer(targetPeerId) {
    if (this.connections.has(targetPeerId)) return
    const conn = this.peer.connect(targetPeerId, {
      reliable: true,
      serialization: 'binary'
    })
    conn.on('open', () => {
      this._setupDataConnection(conn)
      // 发送自我介绍
      this._sendJson(conn, {
        type: 'join',
        nickname: this.nickname,
        peerId: this.myPeerId
      })
    })
    conn.on('error', (e) => console.warn('[P2P] 连接错误:', e))
  }

  /**
   * 处理被动入站连接
   */
  _handleIncomingConnection(conn) {
    conn.on('open', () => {
      this._setupDataConnection(conn)
    })
  }

  /**
   * 绑定 DataConnection 事件
   */
  _setupDataConnection(conn) {
    this.connections.set(conn.peer, conn)

    conn.on('data', async (data) => {
      await this._handleData(conn.peer, data)
    })

    conn.on('close', () => {
      this.connections.delete(conn.peer)
      this.onMemberLeave(conn.peer)
    })

    conn.on('error', (e) => {
      console.warn('[P2P] DataChannel错误:', e)
      this.connections.delete(conn.peer)
    })
  }

  /**
   * 解析接收到的数据
   */
  async _handleData(fromPeerId, data) {
    try {
      let msg
      if (data instanceof ArrayBuffer) {
        // 二进制：文件分片
        await this._handleFileChunk(fromPeerId, data)
        return
      } else if (typeof data === 'string') {
        // JSON 控制消息（加密）
        if (this.cryptoKey) {
          try {
            const plain = await decryptMessage(this.cryptoKey, data)
            msg = JSON.parse(plain)
          } catch {
            console.warn('[P2P] 解密失败，丢弃消息')
            return
          }
        } else {
          msg = JSON.parse(data)
        }
      } else {
        return
      }

      switch (msg.type) {
        case 'join':
          this.connections.get(fromPeerId)._nickname = msg.nickname
          this.onMemberJoin({ peerId: fromPeerId, nickname: msg.nickname })
          break
        case 'chat':
          this.onMessage({
            fromPeerId,
            nickname: msg.nickname,
            text: msg.text,
            time: msg.time
          })
          break
        case 'file-meta':
          this._fileBuffers.set(msg.fileId, {
            meta: msg,
            chunks: [],
            received: 0
          })
          this.onFileReceived({ type: 'incoming', meta: msg, fromPeerId })
          break
        case 'file-reject':
          // 对方拒绝，清除缓存
          this._fileBuffers.delete(msg.fileId)
          break
        case 'leave':
          this.onMemberLeave(fromPeerId)
          break
      }
    } catch (e) {
      console.error('[P2P] 数据解析错误:', e)
    }
  }

  /**
   * 处理文件分片（二进制）
   * 协议：前4字节为 fileId(uint32)，其余为数据
   */
  async _handleFileChunk(fromPeerId, buffer) {
    const view = new DataView(buffer)
    const fileId = view.getUint32(0)
    const isLast = view.getUint8(4) === 1
    const chunk = buffer.slice(5)

    const entry = this._fileBuffers.get(String(fileId))
    if (!entry) return

    entry.chunks.push(chunk)
    entry.received += chunk.byteLength

    if (isLast) {
      // 合并所有分片
      const total = entry.chunks.reduce((s, c) => s + c.byteLength, 0)
      const merged = new Uint8Array(total)
      let offset = 0
      for (const c of entry.chunks) {
        merged.set(new Uint8Array(c), offset)
        offset += c.byteLength
      }

      let finalBuffer = merged.buffer
      // 如果有加密密钥，解密
      if (this.cryptoKey) {
        try {
          finalBuffer = await decryptBuffer(this.cryptoKey, finalBuffer)
        } catch (e) {
          console.error('[P2P] 文件解密失败')
          this._fileBuffers.delete(String(fileId))
          return
        }
      }

      this.onFileReceived({
        type: 'complete',
        fileId: String(fileId),
        buffer: finalBuffer,
        meta: entry.meta,
        fromPeerId
      })
      this._fileBuffers.delete(String(fileId))
    }
  }

  /**
   * 发送加密 JSON 消息
   */
  async _sendJson(conn, obj) {
    const text = JSON.stringify(obj)
    if (this.cryptoKey) {
      const encrypted = await encryptMessage(this.cryptoKey, text)
      conn.send(encrypted)
    } else {
      conn.send(text)
    }
  }

  /**
   * 广播文本消息给所有成员
   * @param {string} text
   */
  async broadcastMessage(text) {
    const msg = {
      type: 'chat',
      nickname: this.nickname,
      text,
      time: Date.now()
    }
    for (const conn of this.connections.values()) {
      if (conn.open) await this._sendJson(conn, msg)
    }
    return msg
  }

  /**
   * 向指定成员发送文件（不写磁盘，纯内存传输）
   * @param {string} targetPeerId
   * @param {File} file
   * @param {Function} onProgress
   */
  async sendFile(targetPeerId, file, onProgress) {
    const conn = this.connections.get(targetPeerId)
    if (!conn || !conn.open) throw new Error('对方未在线')

    const fileId = Date.now() & 0xFFFFFFFF
    const CHUNK_SIZE = 16 * 1024 // 16KB per chunk

    // 1. 发送文件元数据
    await this._sendJson(conn, {
      type: 'file-meta',
      fileId: String(fileId),
      name: file.name,
      size: file.size,
      mimeType: file.type,
      sender: this.nickname
    })

    // 2. 读取文件到 ArrayBuffer
    const arrayBuffer = await file.arrayBuffer()

    // 3. 加密（如果有密钥）
    let dataToSend = arrayBuffer
    if (this.cryptoKey) {
      dataToSend = await encryptBuffer(this.cryptoKey, arrayBuffer)
    }

    // 4. 分片发送
    const totalChunks = Math.ceil(dataToSend.byteLength / CHUNK_SIZE)
    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE
      const end = Math.min(start + CHUNK_SIZE, dataToSend.byteLength)
      const chunk = dataToSend.slice(start, end)

      const isLast = i === totalChunks - 1
      const packet = new ArrayBuffer(5 + chunk.byteLength)
      const view = new DataView(packet)
      view.setUint32(0, fileId)
      view.setUint8(4, isLast ? 1 : 0)
      new Uint8Array(packet).set(new Uint8Array(chunk), 5)

      conn.send(packet)
      onProgress && onProgress(Math.round(((i + 1) / totalChunks) * 100))

      // 流控：避免阻塞
      if (i % 10 === 9) await new Promise(r => setTimeout(r, 1))
    }
  }

  /**
   * 发起音视频通话（向所有已连接成员）
   * @param {MediaStream} localStream
   */
  async startVideoCall(localStream) {
    this.localStream = localStream
    for (const [peerId, conn] of this.connections.entries()) {
      if (conn.open) {
        const call = this.peer.call(peerId, localStream)
        this._handleOutgoingCall(call)
      }
    }
  }

  /**
   * 处理入站通话
   */
  _handleIncomingCall(call) {
    // 自动接听（用户已在房间内意味着同意通话）
    if (this.localStream) {
      call.answer(this.localStream)
    } else {
      navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then(stream => {
        this.localStream = stream
        call.answer(stream)
      }).catch(() => {
        call.answer() // 仅音频
      })
    }
    call.on('stream', (remoteStream) => {
      this.mediaConnections.set(call.peer, call)
      this.onRemoteStream({ peerId: call.peer, stream: remoteStream })
    })
    call.on('close', () => {
      this.mediaConnections.delete(call.peer)
      this.onRemoteStreamClose(call.peer)
    })
  }

  _handleOutgoingCall(call) {
    call.on('stream', (remoteStream) => {
      this.mediaConnections.set(call.peer, call)
      this.onRemoteStream({ peerId: call.peer, stream: remoteStream })
    })
    call.on('close', () => {
      this.mediaConnections.delete(call.peer)
      this.onRemoteStreamClose(call.peer)
    })
  }

  /**
   * 停止通话，释放媒体流
   */
  stopVideoCall() {
    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop())
      this.localStream = null
    }
    this.mediaConnections.forEach(call => call.close())
    this.mediaConnections.clear()
  }

  /**
   * 离开房间，断开所有连接
   */
  async leave() {
    // 广播离开通知
    for (const conn of this.connections.values()) {
      if (conn.open) {
        await this._sendJson(conn, {
          type: 'leave',
          nickname: this.nickname
        })
      }
    }
    this.stopVideoCall()
    this.connections.forEach(c => c.close())
    this.connections.clear()
    if (this.peer) {
      this.peer.destroy()
      this.peer = null
    }
  }

  /**
   * 获取在线成员列表
   */
  getMembers() {
    const list = []
    this.connections.forEach((conn, peerId) => {
      list.push({
        peerId,
        nickname: conn._nickname || '未知成员',
        online: conn.open
      })
    })
    return list
  }
}
