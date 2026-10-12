/** Copias de la clave de datos guardadas en Supabase (tabla vault_slots). Ninguna sirve sin su frase. */
import { changePassphrase, createVault, KeySlot, unwrapDataKey } from "../vault/crypto";
import { supabase } from "./client";

export const RECOVERY = "recuperacion";

export interface Member { user_id: string; name: string }
export interface Slots { mine: KeySlot | null; recovery: KeySlot | null }

/** La API solo devuelve mi copia y la de recuperación (protección por filas). */
export async function loadSlots(userId: string): Promise<Slots> {
  const { data, error } = await supabase.from("vault_slots").select("name, user_id, slot");
  if (error) throw new Error(error.message);
  const rows = data as { name: string; user_id: string | null; slot: KeySlot }[];
  return {
    mine: rows.find((r) => r.user_id === userId)?.slot ?? null,
    recovery: rows.find((r) => r.name === RECOVERY)?.slot ?? null,
  };
}

async function saveSlot(name: string, userId: string | null, slot: KeySlot) {
  const { error } = await supabase.from("vault_slots").upsert({ name, user_id: userId, slot }, { onConflict: "name" });
  if (error) throw new Error(error.message);
}

/** Primera vez: crea la clave de datos, mi copia y la de recuperación. Devuelve el código para imprimir. */
export async function createHouseVault(me: Member, passphrase: string) {
  const vault = await createVault({ [me.name]: passphrase });
  // La de recuperación primero: si otro miembro la creó a la vez, esto falla y no se crean dos claves
  const { error } = await supabase.from("vault_slots").insert({ name: RECOVERY, user_id: null, slot: vault.slots[RECOVERY] });
  if (error) throw new Error(error.code === "23505" ? "Otro miembro acaba de crear la bóveda: recarga la página." : error.message);
  await saveSlot(me.name, me.user_id, vault.slots[me.name]);
  return vault;
}

export const unlock = unwrapDataKey;

/** Con el código de recuperación: me crea (o rehace) mi copia con una frase nueva. */
export async function recoverWithCode(me: Member, recovery: KeySlot, code: string, newPassphrase: string) {
  const slot = await changePassphrase(recovery, code, newPassphrase);
  await saveSlot(me.name, me.user_id, slot);
  return unwrapDataKey(slot, newPassphrase);
}

/** Cambia mi frase (también para sustituir una provisional). */
export async function changeMyPassphrase(me: Member, mine: KeySlot, oldPassphrase: string, newPassphrase: string) {
  const slot = await changePassphrase(mine, oldPassphrase, newPassphrase);
  await saveSlot(me.name, me.user_id, slot);
  return unwrapDataKey(slot, newPassphrase);
}

/** Da acceso a otro miembro con una frase provisional (se la dices en persona; tendrá que cambiarla al entrar). */
export async function grantAccess(other: Member, mine: KeySlot, myPassphrase: string, temporary: string) {
  const slot = await changePassphrase(mine, myPassphrase, temporary);
  const { error } = await supabase.from("vault_slots").insert({ name: other.name, user_id: other.user_id, slot: { ...slot, temporary: true } });
  if (error) throw new Error(error.code === "23505" ? `${other.name} ya tiene acceso.` : error.message);
}

export async function loadMembers(): Promise<Member[]> {
  const { data, error } = await supabase.from("members").select("user_id, name").order("name");
  if (error) throw new Error(error.message);
  return data as Member[];
}

