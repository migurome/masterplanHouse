import { describe, expect, it } from "vitest";
import {
  changePassphrase, createVault, decryptFile, decryptRecord, encryptFile, encryptRecord, normalizeRecoveryCode,
  passphraseProblem, unwrapDataKey, VaultError,
} from "./crypto";

// Pocas iteraciones en los tests para que vayan rápidos (en la app son 600.000)
const IT = 1_000;
const USERS = { ana: "caballo bateria grapa correcta", luis: "tres tristes tigres comen trigo" };
const expense = { date: "2026-05-02", amount: 32.5, description: "DIGI", tags: ["Internet"] };

describe("bóveda", () => {
  it("cada usuario y el código de recuperación abren los mismos datos", async () => {
    const v = await createVault(USERS, IT);
    const blob = await encryptRecord(v.key, "expenses", "id-1", expense);
    expect(blob.startsWith("v1.")).toBe(true);
    expect(blob).not.toContain("DIGI");
    for (const [user, pass] of Object.entries(USERS)) {
      const k = await unwrapDataKey(v.slots[user], pass);
      expect(await decryptRecord(k, "expenses", "id-1", blob)).toEqual(expense);
    }
    const rec = await unwrapDataKey(v.slots.recuperacion, normalizeRecoveryCode(v.recoveryCode.toLowerCase().replace(/-/g, " ")));
    expect(await decryptRecord(rec, "expenses", "id-1", blob)).toEqual(expense);
  });

  it("da igual mayúsculas y espacios de más", async () => {
    const v = await createVault(USERS, IT);
    const k = await unwrapDataKey(v.slots.ana, "  Caballo  BATERIA grapa\tcorrecta ");
    const blob = await encryptRecord(v.key, "expenses", "id-1", expense);
    expect(await decryptRecord(k, "expenses", "id-1", blob)).toEqual(expense);
    const rec = await unwrapDataKey(v.slots.recuperacion, v.recoveryCode.toLowerCase());
    expect(await decryptRecord(rec, "expenses", "id-1", blob)).toEqual(expense);
  });

  it("una frase incorrecta no abre nada", async () => {
    const v = await createVault(USERS, IT);
    await expect(unwrapDataKey(v.slots.ana, "otra frase cualquiera larga")).rejects.toThrow(VaultError);
  });

  it("la clave abierta no se puede exportar", async () => {
    const v = await createVault(USERS, IT);
    await expect(crypto.subtle.exportKey("raw", v.key)).rejects.toThrow();
  });

  it("un bloque movido a otra fila o alterado falla", async () => {
    const v = await createVault(USERS, IT);
    const blob = await encryptRecord(v.key, "expenses", "id-1", expense);
    await expect(decryptRecord(v.key, "expenses", "id-2", blob)).rejects.toThrow(VaultError);
    await expect(decryptRecord(v.key, "incomes", "id-1", blob)).rejects.toThrow(VaultError);
    const tampered = blob.slice(0, -4) + (blob.endsWith("AAAA") ? "BBBB" : "AAAA");
    await expect(decryptRecord(v.key, "expenses", "id-1", tampered)).rejects.toThrow(VaultError);
  });

  it("cifrar dos veces lo mismo da bloques distintos", async () => {
    const v = await createVault(USERS, IT);
    const a = await encryptRecord(v.key, "expenses", "id-1", expense);
    const b = await encryptRecord(v.key, "expenses", "id-1", expense);
    expect(a).not.toEqual(b);
  });

  it("cambiar la frase de un usuario no toca los datos ni la del otro", async () => {
    const v = await createVault(USERS, IT);
    const blob = await encryptRecord(v.key, "expenses", "id-1", expense);
    const slot = await changePassphrase(v.slots.ana, USERS.ana, "nueva frase de ana muy larga", IT);
    await expect(unwrapDataKey(slot, USERS.ana)).rejects.toThrow(VaultError);
    const k = await unwrapDataKey(slot, "nueva frase de ana muy larga");
    expect(await decryptRecord(k, "expenses", "id-1", blob)).toEqual(expense);
    await expect(changePassphrase(v.slots.luis, "mal", "otra frase nueva bastante larga", IT)).rejects.toThrow(VaultError);
  });

  it("los PDF se cifran ligados a su id", async () => {
    const v = await createVault(USERS, IT);
    const pdf = new TextEncoder().encode("%PDF-1.4 factura");
    const sealed = await encryptFile(v.key, "doc-1", pdf);
    expect(new TextDecoder().decode(sealed)).not.toContain("factura");
    expect(await decryptFile(v.key, "doc-1", sealed)).toEqual(pdf);
    await expect(decryptFile(v.key, "doc-2", sealed)).rejects.toThrow(VaultError);
  });

  it("exige frases largas", async () => {
    expect(passphraseProblem("corta")).not.toBeNull();
    expect(passphraseProblem("aaaaaaaaaaaaaaaa")).not.toBeNull();
    expect(passphraseProblem(USERS.ana)).toBeNull();
    await expect(createVault({ ana: "corta" }, IT)).rejects.toThrow(VaultError);
  });
});
