import { database } from "./runtime";

export type PushSubscriptionRecord = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

export type PushMessage = {
  title: string;
  body: string;
  href: string;
  tag: string;
};

const encoder = new TextEncoder();

function base64UrlEncode(bytes: Uint8Array) {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function base64UrlDecode(value: string) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - value.length % 4) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function join(...parts: Uint8Array[]) {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}

async function hkdf(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8);
  return new Uint8Array(bits);
}

function vapidKeys() {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  return publicKey && privateKey ? { publicKey, privateKey } : null;
}

export function pushIsConfigured() {
  return Boolean(vapidKeys());
}

export function publicVapidKey() {
  return vapidKeys()?.publicKey ?? null;
}

async function vapidAuthorization(endpoint: string, publicKey: string, privateKey: string) {
  const publicBytes = base64UrlDecode(publicKey);
  if (publicBytes.length !== 65 || publicBytes[0] !== 4) throw new Error("Invalid VAPID public key");
  const privateBytes = base64UrlDecode(privateKey);
  if (privateBytes.length !== 32) throw new Error("Invalid VAPID private key");
  const header = base64UrlEncode(encoder.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const audience = new URL(endpoint).origin;
  const payload = base64UrlEncode(encoder.encode(JSON.stringify({ aud: audience, exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60, sub: process.env.VAPID_SUBJECT || "mailto:notifications@coreshift.app" })));
  const key = await crypto.subtle.importKey("jwk", {
    kty: "EC", crv: "P-256", d: privateKey,
    x: base64UrlEncode(publicBytes.slice(1, 33)),
    y: base64UrlEncode(publicBytes.slice(33, 65)),
  }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, encoder.encode(`${header}.${payload}`)));
  return `vapid t=${header}.${payload}.${base64UrlEncode(signature)}, k=${publicKey}`;
}

async function encryptPushPayload(subscription: PushSubscriptionRecord, message: PushMessage) {
  const userPublicKey = base64UrlDecode(subscription.p256dh);
  const authSecret = base64UrlDecode(subscription.auth);
  if (userPublicKey.length !== 65 || authSecret.length !== 16) throw new Error("Invalid push subscription");
  const userKey = await crypto.subtle.importKey("raw", userPublicKey, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const serverKeys = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: userKey }, serverKeys.privateKey, 256));
  const serverPublicKey = new Uint8Array(await crypto.subtle.exportKey("raw", serverKeys.publicKey));
  const keyInfo = join(encoder.encode("WebPush: info\0"), userPublicKey, serverPublicKey);
  const ikm = await hkdf(sharedSecret, authSecret, keyInfo, 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(ikm, salt, encoder.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(ikm, salt, encoder.encode("Content-Encoding: nonce\0"), 12);
  const contentKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const plaintext = join(encoder.encode(JSON.stringify(message)), new Uint8Array([2]));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, contentKey, plaintext));
  const recordSize = new Uint8Array([0, 0, 16, 0]);
  return join(salt, recordSize, new Uint8Array([serverPublicKey.length]), serverPublicKey, ciphertext);
}

export async function sendPush(subscription: PushSubscriptionRecord, message: PushMessage) {
  const keys = vapidKeys();
  if (!keys) return { ok: false, remove: false };
  try {
    const [payload, authorization] = await Promise.all([
      encryptPushPayload(subscription, message),
      vapidAuthorization(subscription.endpoint, keys.publicKey, keys.privateKey),
    ]);
    const response = await fetch(subscription.endpoint, {
      method: "POST",
      headers: { Authorization: authorization, "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: "60", Urgency: "high" },
      body: payload,
    });
    return { ok: response.ok, remove: response.status === 404 || response.status === 410 };
  } catch {
    return { ok: false, remove: false };
  }
}

export async function sendMessagePushes(input: { businessId: string; senderType: "owner" | "employee"; senderId: number; senderName: string; conversationId: string; messageId: number; body: string; hasMedia: boolean }) {
  if (!pushIsConfigured()) return;
  const db = database();
  let query: D1PreparedStatement;
  if (input.conversationId.startsWith("direct-")) {
    const employeeId = Number(input.conversationId.slice("direct-".length));
    if (input.senderType === "owner") {
      query = db.prepare("SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE business_id = ? AND user_type = 'employee' AND user_id = ?").bind(input.businessId, employeeId);
    } else {
      query = db.prepare("SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE business_id = ? AND user_type = 'owner' AND user_id != ?").bind(input.businessId, input.senderId);
    }
  } else if (input.conversationId === "managers") {
    query = db.prepare("SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE business_id = ? AND user_type = 'owner' AND NOT (user_type = ? AND user_id = ?)").bind(input.businessId, input.senderType, input.senderId);
  } else {
    query = db.prepare("SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE business_id = ? AND NOT (user_type = ? AND user_id = ?)").bind(input.businessId, input.senderType, input.senderId);
  }
  const subscriptions = (await query.all<PushSubscriptionRecord>()).results;
  const message: PushMessage = { title: `Message from ${input.senderName}`, body: input.body || (input.hasMedia ? "Sent a photo." : "New message"), href: "/messages", tag: `message:${input.messageId}` };
  const results = await Promise.all(subscriptions.map((subscription) => sendPush(subscription, message).then((result) => ({ subscription, result }))));
  const stale = results.filter(({ result }) => result.remove).map(({ subscription }) => subscription.endpoint);
  if (stale.length) await db.batch(stale.map((endpoint) => db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind(endpoint)));
}
