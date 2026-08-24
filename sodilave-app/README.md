# Sodilave — Gestão de Produção

Aplicação interna de gestão operacional da Sodilave, construída com Next.js 15, TypeScript, Prisma e MariaDB/MySQL.

## Ambiente de desenvolvimento

Requisitos:

- Node.js 22
- MariaDB/MySQL

Instalação local:

```bash
npm install
npx prisma generate
npm run db:lots
npm run db:seed
npm run dev
```

O `seed` é exclusivamente para desenvolvimento/testes. Os utilizadores criados pelo seed usam PINs iniciais de 8 algarismos.

## Validação

Antes de qualquer deploy:

```bash
npm run typecheck
npm run build
```

Para validar a configuração completa de produção:

```bash
npm run verify:production
npm run build:production
```

## Produção

A aplicação interna deve ser publicada num endereço separado do website institucional.

- Website institucional: `www.sodilave.pt`
- Aplicação interna: `producao.sodilave.pt`

O alojamento de produção usa cPanel / CloudLinux / Passenger com Node.js 22.

As instruções completas estão em:

```text
DEPLOY_CPANEL.md
```

### Regras importantes de produção

- Não executar `npm run db:seed` na base de dados real.
- Usar `npm run db:production` para preparar/aplicar a estrutura suportada em produção.
- Usar PINs de exatamente 8 algarismos.
- PINs não podem ser repetidos entre utilizadores.
- `SESSION_SECRET` deve ter pelo menos 32 caracteres.
- HTTPS é obrigatório.
- Confirmar `/api/health` depois de cada deploy.
- Fazer backup antes de alterações à aplicação ou base de dados.

## Scripts principais

```text
npm run dev                 Desenvolvimento local
npm run typecheck           Verificação TypeScript
npm run build               Build Next.js
npm run build:production    Validação + typecheck + build de produção
npm run verify:production   Validar variáveis do servidor
npm run db:lots             Aplicar tabelas auxiliares no desenvolvimento
npm run db:production       Preparar/aplicar estrutura da BD em produção
npm run backup:db           Criar backup comprimido da BD
npm start                   Arrancar através de app.js/server.cjs
```

## Estrutura

- `app/` — páginas, rotas e Server Actions.
- `components/` — componentes reutilizáveis.
- `lib/` — autenticação, base de dados, lotes, turnos, métricas e regras operacionais.
- `prisma/` — schema e SQL auxiliar.
- `scripts/` — preparação da BD, validação e backups.
- `public/` — imagens e recursos estáticos.

A aplicação mantém-se em fase `0.9.x` até concluir a instalação e validação com utilização real no servidor de produção.
