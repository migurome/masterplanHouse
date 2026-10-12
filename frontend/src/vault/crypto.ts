/**
 * Cifrado de los datos en el navegador (cifrado de extremo a extremo).
 *
 * - Una CLAVE DE DATOS aleatoria (AES-256-GCM) cifra cada registro y cada PDF. Supabase solo guarda bloques
 *   ilegibles: ni importes, ni fechas, ni conceptos.
 * - La clave de datos nunca se guarda en claro: se guarda ENVUELTA (cifrada) una vez por usuario, con una clave
 *   derivada de su frase secreta (PBKDF2-SHA256), y otra vez con el CÓDIGO DE RECUPERACIÓN.
 * - Cada registro va ligado a su tabla y su id (AAD): un bloque no se puede mover a otra fila sin que falle.
 * - Formato con versión ("v1.") para poder cambiar de algoritmo sin perder los datos antiguos.
 *
 * Sin la frase de un usuario o el código de recuperación los datos NO se pueden recuperar.
 */

const VERSION = "v1";
const PBKDF2_ITERATIONS = 600_000; // recomendación OWASP para PBKDF2-SHA256
const IV_BYTES = 12;
const SALT_BYTES = 16;
const RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sin 0/O ni 1/I: se copia a mano sin errores
const RECOVERY_GROUPS = 6; // 6 grupos de 5 = 30 caracteres de 32 símbolos = 150 bits

const enc = new TextEncoder();
const dec = new TextDecoder();

export class VaultError extends Error {}

/** Copia de la clave de datos cifrada con la frase de un usuario (o el código de recuperación). */
export interface KeySlot {
  kdf: "PBKDF2-SHA256";
  iterations: number;
  salt: string; // base64
  iv: string; // base64
  wrapped: string; // base64: clave de datos cifrada
  temporary?: boolean; // frase provisional que dio otro miembro: hay que cambiarla al entrar
}

// ---------- base64 ----------
export function toB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));

// ---------- claves ----------
/** Clave de datos nueva. Es exportable solo para poder envolverla al crear la bóveda. */
export function newDataKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}

/** La frase vale igual con mayúsculas, acentos compuestos o espacios de más: "Tortilla  Nube " = "tortilla nube". */
export function normalizeSecret(secret: string): string {
  return secret.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

async function deriveWrappingKey(secret: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", enc.encode(normalizeSecret(secret)), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["wrapKey", "unwrapKey"],
  );
}

/** Envuelve la clave de datos con una frase secreta (o el código de recuperación). */
export async function wrapDataKey(dataKey: CryptoKey, secret: string, iterations = PBKDF2_ITERATIONS): Promise<KeySlot> {
  const salt = random(SALT_BYTES);
  const iv = random(IV_BYTES);
  const kek = await deriveWrappingKey(secret, salt, iterations);
  const wrapped = new Uint8Array(await crypto.subtle.wrapKey("raw", dataKey, kek, { name: "AES-GCM", iv }));
  return { kdf: "PBKDF2-SHA256", iterations, salt: toB64(salt), iv: toB64(iv), wrapped: toB64(wrapped) };
}

/** Abre la clave de datos. La que se devuelve NO es exportable: solo cifra y descifra. */
export async function unwrapDataKey(slot: KeySlot, secret: string): Promise<CryptoKey> {
  if (slot.kdf !== "PBKDF2-SHA256") throw new VaultError(`Derivación de clave desconocida: ${slot.kdf}`);
  const kek = await deriveWrappingKey(secret, fromB64(slot.salt), slot.iterations);
  try {
    return await crypto.subtle.unwrapKey(
      "raw", fromB64(slot.wrapped), kek, { name: "AES-GCM", iv: fromB64(slot.iv) },
      { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"],
    );
  } catch {
    throw new VaultError("Frase secreta incorrecta");
  }
}

/** Código de recuperación para imprimir: "ABCDE-FGHJK-…" (150 bits). */
export function newRecoveryCode(): string {
  const groups: string[] = [];
  for (let g = 0; g < RECOVERY_GROUPS; g++) {
    let s = "";
    // 32 símbolos y bytes 0-255: 256 % 32 == 0, así que el módulo no sesga
    for (const b of random(5)) s += RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length];
    groups.push(s);
  }
  return groups.join("-");
}

/** Normaliza un código tecleado (minúsculas, espacios, sin guiones). */
export function normalizeRecoveryCode(code: string): string {
  const s = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return s.match(/.{1,5}/g)?.join("-") ?? "";
}

/** Requisitos mínimos de una frase secreta (devuelve el problema o null si vale). */
export function passphraseProblem(raw: string): string | null {
  const p = normalizeSecret(raw);
  if (p.length < 14) return "Usa al menos 14 caracteres (mejor 4 o 5 palabras sueltas).";
  if (new Set(p).size < 6) return "Tiene demasiados caracteres repetidos.";
  return null;
}

// ---------- registros y archivos ----------
const aadOf = (table: string, id: string) => enc.encode(`${VERSION}|${table}|${id}`);

/** Cifra un registro (cualquier objeto JSON) ligado a su tabla e id: "v1.<base64(iv+cifrado)>". */
export async function encryptRecord(key: CryptoKey, table: string, id: string, data: unknown): Promise<string> {
  const iv = random(IV_BYTES);
  const ct = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aadOf(table, id) }, key, enc.encode(JSON.stringify(data)),
  ));
  const out = new Uint8Array(IV_BYTES + ct.length);
  out.set(iv);
  out.set(ct, IV_BYTES);
  return `${VERSION}.${toB64(out)}`;
}

export async function decryptRecord<T = unknown>(key: CryptoKey, table: string, id: string, blob: string): Promise<T> {
  const [version, body] = blob.split(".", 2);
  if (version !== VERSION || !body) throw new VaultError(`Formato de cifrado desconocido: ${version}`);
  const raw = fromB64(body);
  try {
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: raw.subarray(0, IV_BYTES), additionalData: aadOf(table, id) }, key, raw.subarray(IV_BYTES),
    );
    return JSON.parse(dec.decode(pt)) as T;
  } catch {
    throw new VaultError(`No se puede descifrar ${table}/${id}: clave incorrecta o datos alterados`);
  }
}

/** Cifra un archivo (PDF): bytes "v1" + iv + cifrado, ligado a su id. */
export async function encryptFile(key: CryptoKey, id: string, bytes: Uint8Array): Promise<Uint8Array> {
  const iv = random(IV_BYTES);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aadOf("file", id) }, key, bytes));
  const head = enc.encode(VERSION);
  const out = new Uint8Array(head.length + IV_BYTES + ct.length);
  out.set(head);
  out.set(iv, head.length);
  out.set(ct, head.length + IV_BYTES);
  return out;
}

export async function decryptFile(key: CryptoKey, id: string, data: Uint8Array): Promise<Uint8Array> {
  const head = enc.encode(VERSION);
  if (dec.decode(data.subarray(0, head.length)) !== VERSION) throw new VaultError("Archivo con formato de cifrado desconocido");
  const iv = data.subarray(head.length, head.length + IV_BYTES);
  try {
    return new Uint8Array(await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: aadOf("file", id) }, key, data.subarray(head.length + IV_BYTES),
    ));
  } catch {
    throw new VaultError(`No se puede descifrar el archivo ${id}: clave incorrecta o datos alterados`);
  }
}

// ---------- bóveda ----------
export interface NewVault {
  slots: Record<string, KeySlot>; // usuario -> su copia; "recuperacion" -> la del código
  recoveryCode: string;
  key: CryptoKey; // clave de datos abierta (en memoria)
}

/** Crea la bóveda: clave de datos, una copia por usuario y otra para el código de recuperación. */
export async function createVault(users: Record<string, string>, iterations = PBKDF2_ITERATIONS): Promise<NewVault> {
  for (const [user, pass] of Object.entries(users)) {
    const problem = passphraseProblem(pass);
    if (problem) throw new VaultError(`${user}: ${problem}`);
  }
  const dataKey = await newDataKey();
  const recoveryCode = newRecoveryCode();
  const slots: Record<string, KeySlot> = {};
  for (const [user, pass] of Object.entries(users)) slots[user] = await wrapDataKey(dataKey, pass, iterations);
  slots.recuperacion = await wrapDataKey(dataKey, recoveryCode, iterations);
  // Antes de dar nada por bueno: cada frase abre su copia
  for (const [user, pass] of Object.entries(users)) await unwrapDataKey(slots[user], pass);
  // La copia exportable no sale de aquí: se devuelve una no exportable para trabajar
  const key = await unwrapDataKey(slots.recuperacion, recoveryCode);
  return { slots, recoveryCode, key };
}

/** Cambia la frase de un usuario: solo se reenvuelve su copia (los datos no se tocan). */
export async function changePassphrase(slot: KeySlot, oldSecret: string, newSecret: string, iterations = PBKDF2_ITERATIONS): Promise<KeySlot> {
  const problem = passphraseProblem(newSecret);
  if (problem) throw new VaultError(problem);
  // Para reenvolver hace falta una copia exportable de la clave de datos: se abre solo para esto
  const kek = await deriveWrappingKey(oldSecret, fromB64(slot.salt), slot.iterations);
  let exportable: CryptoKey;
  try {
    exportable = await crypto.subtle.unwrapKey(
      "raw", fromB64(slot.wrapped), kek, { name: "AES-GCM", iv: fromB64(slot.iv) },
      { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"],
    );
  } catch {
    throw new VaultError("Frase secreta incorrecta");
  }
  return wrapDataKey(exportable, newSecret, iterations);
}
