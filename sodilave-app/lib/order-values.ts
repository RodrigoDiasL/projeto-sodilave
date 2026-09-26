// All prices are EUR per individual article, excluding VAT. Keep four decimals
// for unit prices and round each line once, to cents, using integer arithmetic.
export function parseUnitPrice(value: unknown) {
  const text = String(value ?? "").trim().replace(",", ".");
  if (!/^\d{1,8}(?:\.\d{1,4})?$/.test(text)) throw new Error("Preço inválido. Use até 4 casas decimais, sem separador de milhares.");
  const [whole, fraction = ""] = text.split(".");
  return `${Number(whole)}.${fraction.padEnd(4, "0")}`;
}
export function lineTotalCents(quantity: number, price: string) {
  if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 10000000) throw new Error("A quantidade deve estar entre 1 e 10 000 000 artigos.");
  const normalized = parseUnitPrice(price);
  const cents = (BigInt(quantity) * BigInt(normalized.replace(".", "")) + BigInt(50)) / BigInt(100);
  if (cents > BigInt(99999999999)) throw new Error("O valor da encomenda excede o limite permitido.");
  return Number(cents);
}
export function validOrderDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "2000-01-01" || value > "2099-12-31") return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0,10) === value;
}
export const orderReference = (id: number) => `ENC-${String(id).padStart(6,"0")}`;
export const formatEuro = (cents: number) => (cents / 100).toLocaleString("pt-PT", { style:"currency", currency:"EUR" });
