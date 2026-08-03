import { readFile, writeFile, unlink } from "node:fs/promises";

const base64Path = new URL("../public/maq-garrafoes.png.base64.txt", import.meta.url);
const outputPath = new URL("../public/maq-garrafoes.png", import.meta.url);
const content = (await readFile(base64Path, "utf8")).trim();
await writeFile(outputPath, Buffer.from(content, "base64"));
await unlink(base64Path);
console.log("Imagem restaurada em public/maq-garrafoes.png");
