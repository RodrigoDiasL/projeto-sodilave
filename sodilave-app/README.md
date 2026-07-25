# Sodilave — Gestão de Produção

Primeira base funcional da aplicação interna, construída com Next.js, TypeScript, Prisma e MariaDB/MySQL.

## Incluído

- Login apenas por PIN, com sessão segura em cookie HTTP-only.
- Perfis de Operador e Administrador.
- Botão de administração visível, mas acesso bloqueado no servidor a operadores.
- Registo de produção com gravação em rascunho e finalização confirmada.
- Associação de lotes de matérias-primas por dropdown.
- Geração automática do lote do produto acabado através de regra configurável.
- Verificação de Turno da máquina separado do verificação de turno geral do turno.
- Administração de utilizadores, máquinas, produtos, matérias-primas, lotes e regras.
- Consultas básicas de produções, verificações de turno e atividade.
- Registo de auditoria.

## Instalação local

1. Instalar Node.js 20 ou superior e MariaDB/MySQL.
2. Copiar `.env.example` para `.env` e configurar a ligação.
3. Executar:

```bash
npm install
npx prisma migrate dev --name initial
npm run db:seed
npm run dev
```

Abrir `http://localhost:3000`.

Credenciais de demonstração após o seed:

- Administrador: `1111`
- Operador: `2222`

Altere estes PINs antes de utilizar em produção.

## Publicação em cPanel

1. Criar a base de dados MariaDB e o utilizador no cPanel.
2. Carregar o projeto e criar o ficheiro `.env`.
3. No terminal do cPanel: `npm install`, `npm run db:deploy`, `npm run db:seed`, `npm run build`.
4. Em **Setup Node.js App**, selecionar Node 20+, apontar para a pasta do projeto e usar `npm start`.
5. Definir `SESSION_SECRET` com uma chave longa e aleatória.

## Decisões que ainda precisam de validação

- A regra real de nomenclatura do lote produzido. A aplicação inclui um editor de modelo com tokens.
- Regras de desconto de stock: quantidade colocada na máquina versus quantidade efetivamente consumida.
- Procedimento para corrigir registos finalizados por administradores.
- Formato final das etiquetas e integração com cada mini impressora.
- Integração futura com NFC de assiduidade e estado automático das máquinas.

## Estrutura principal

- `app/` — páginas e ações do servidor.
- `components/` — componentes reutilizáveis.
- `lib/` — autenticação, base de dados, turnos e geração de lotes.
- `prisma/` — modelo de dados e dados de demonstração.
