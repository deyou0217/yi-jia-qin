/**
 * 加密工具模块
 * 使用 PBKDF2 派生密钥，AES-GCM 加密/解密
 * 完全基于 Web Crypto API，无需任何服务器
 */

/**
 * 从房间号+密码派生 AES-GCM 加密密钥
 * @param {string} roomId - 房间号
 * @param {string} password - 房间密码
 * @returns {Promise<CryptoKey>}
 */
export async function deriveKey(roomId, password) {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey']
  )
  const salt = enc.encode(roomId.padEnd(16, '0').slice(0, 16))
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

/**
 * 加密字符串消息
 * @param {CryptoKey} key
 * @param {string} plaintext
 * @returns {Promise<string>} base64编码的密文
 */
export async function encryptMessage(key, plaintext) {
  const enc = new TextEncoder()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(plaintext)
  )
  // 将 iv + ciphertext 打包成 base64
  const combined = new Uint8Array(iv.length + ciphertext.byteLength)
  combined.set(iv)
  combined.set(new Uint8Array(ciphertext), iv.length)
  return btoa(String.fromCharCode(...combined))
}

/**
 * 解密字符串消息
 * @param {CryptoKey} key
 * @param {string} base64Cipher - base64编码的密文
 * @returns {Promise<string>} 明文
 */
export async function decryptMessage(key, base64Cipher) {
  const combined = Uint8Array.from(atob(base64Cipher), c => c.charCodeAt(0))
  const iv = combined.slice(0, 12)
  const ciphertext = combined.slice(12)
  const dec = new TextDecoder()
  const plainBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  )
  return dec.decode(plainBuffer)
}

/**
 * 加密二进制数据（文件传输用）
 * @param {CryptoKey} key
 * @param {ArrayBuffer} buffer
 * @returns {Promise<ArrayBuffer>}
 */
export async function encryptBuffer(key, buffer) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    buffer
  )
  const combined = new Uint8Array(12 + ciphertext.byteLength)
  combined.set(iv)
  combined.set(new Uint8Array(ciphertext), 12)
  return combined.buffer
}

/**
 * 解密二进制数据
 * @param {CryptoKey} key
 * @param {ArrayBuffer} buffer
 * @returns {Promise<ArrayBuffer>}
 */
export async function decryptBuffer(key, buffer) {
  const data = new Uint8Array(buffer)
  const iv = data.slice(0, 12)
  const ciphertext = data.slice(12)
  return crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  )
}

/**
 * 生成随机房间号（6位大写字母+数字）
 * @returns {string}
 */
export function generateRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let result = ''
  const arr = crypto.getRandomValues(new Uint8Array(6))
  arr.forEach(b => { result += chars[b % chars.length] })
  return result
}
