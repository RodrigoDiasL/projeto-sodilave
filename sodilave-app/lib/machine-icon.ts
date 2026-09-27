export function isCapMachine(code: string) {
  const normalized = String(code).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return /^(?:m|maq|maquina)?0*[56]$/.test(normalized);
}
