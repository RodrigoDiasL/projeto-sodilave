# Sodilave — Gestão de Produção

Aplicação interna de gestão operacional da Sodilave, construída com Next.js 15, TypeScript e MariaDB/MySQL. A aplicação usa SQL direto através de `mysql2/promise`; não depende de ORM.

## Ambiente de desenvolvimento

Requisitos:

- Node.js 22
- MariaDB/MySQL

Instalação local:

```bash
npm install
npm run db:production
npm run dev
```

Se a base de desenvolvimento estiver vazia, defina `INITIAL_ADMIN_NAME` e `INITIAL_ADMIN_PIN` antes de executar `db:production`.

O seed opcional de desenvolvimento usa igualmente SQL direto:

```bash
npm run db:seed
```

## PINs

A aplicação exige PINs de exatamente 8 algarismos e não permite PINs repetidos.

Existe um comando de recuperação administrativa:

```bash
RESET_USER_NAME="Nome" RESET_USER_PIN="12345678" npm run pins:reset
```

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


## Stock de produto acabado

A aplicação mantém a localização física dos lotes produzidos:

- Armazém 1: 7 colunas × 10 linhas de estibas/montes + 7 × 5 posições de paletes.
- Armazém 2: 7 colunas × 15 linhas de estibas/montes + 7 × 5 posições de paletes.
- Uma posição pode conter vários lotes.
- A unidade normal de stock é o saco; produtos específicos podem ser configurados para usar palete como unidade de produção/stock.
- Ao finalizar uma produção, o operador atribui a quantidade produzida às posições físicas do mapa.
- As saídas para clientes retiram stock das posições indicadas pelo operador.
- Transferências e correções administrativas ficam registadas como movimentos, sem apagar o histórico.
- A rastreabilidade liga produção, matérias-primas, localização atual, saídas, cliente, encomenda e fatura.

## Produção

A aplicação interna deve ser publicada num endereço separado do website institucional.

- Website institucional: `www.sodilave.pt`
- Aplicação interna: `producao.sodilave.pt`

O alojamento de produção usa cPanel / CloudLinux / Passenger com Node.js 22.

As instruções completas estão em:

```text
DEPLOY_CPANEL.md
```

### Base de dados

A estrutura é mantida em SQL versionado:

```text
database/
├── 001-core.sql
└── migrations/
    ├── 2026-07-26-machine7-cavities.sql
    ├── 2026-07-27-commercial-internal-lots.sql
    └── 2026-08-03-production-stock-ledger.sql
```

`npm run db:production`:

1. valida o ambiente de produção;
2. cria o schema base apenas se a base estiver vazia;
3. aplica as migrações SQL ainda não registadas;
4. verifica o checksum de migrações já aplicadas;
5. cria o primeiro administrador apenas quando não existem utilizadores.

Não alterar retroativamente uma migração já aplicada. Qualquer alteração estrutural futura deve ser um novo ficheiro SQL numerado.

### Regras importantes de produção

- Não executar o seed de desenvolvimento na base real.
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
npm run db:seed             Seed opcional de desenvolvimento
npm run db:lots             Aplicar tabelas auxiliares de lotes/stock
npm run db:upgrade          Aplicar schema/migrações na BD configurada (útil em testes locais)
npm run db:production       Preparar/aplicar estrutura da BD em produção
npm run backup:db           Criar backup comprimido da BD
npm run pins:reset          Recuperar um PIN por terminal
npm start                   Arrancar através de app.js/server.cjs
```

## Estrutura

- `app/` — páginas, rotas e Server Actions.
- `components/` — componentes reutilizáveis.
- `lib/` — autenticação, acesso SQL, lotes, turnos, métricas e regras operacionais.
- `database/` — schema SQL e migrações versionadas.
- `scripts/` — preparação da BD, validação, recuperação e backups.
- `public/` — imagens e recursos estáticos.

A aplicação mantém-se em fase `0.9.x` até concluir a instalação e validação com utilização real no servidor de produção.

### Verificação dos fluxos operacionais

Depois de atualizar o código e executar `npm run db:production`, execute
`npm run db:check` com as mesmas variáveis do servidor. Esta verificação é apenas
leitura: deteta migrações pendentes/alteradas e colunas necessárias aos fluxos
operacionais, incluindo `WeeklyStartup.coolingPump1` e `coolingPump2`. Atualizar
apenas o código sem aplicar as migrações pode impedir o arranque semanal.

Os testes de integração executam as ações da aplicação sobre SQL real; apenas a
sessão de utilizador e a invalidação de cache Next são substituídas. Cobrem o ciclo
semanal (incluindo rascunhos e submissões simultâneas), correções com matéria-prima
esgotada, snapshots, expedição, anulação e reposição de stock.

**Usar exclusivamente uma base descartável:** os testes apagam os dados da base
indicada. `TEST_DATABASE_URL` só aceita bases chamadas `sodilave_test` ou `typecheck`.
Prepare essa base com `DATABASE_URL` e `npm run db:upgrade`, depois execute
`TEST_DATABASE_URL='mysql://utilizador:senha@localhost:3306/sodilave_test' npm run test:integration`.
O workflow de CI executa estes testes numa base MySQL isolada.

Administradores podem anular uma saída em **Saída de Lotes → Anular / corrigir**,
indicando o motivo. O stock regressa às posições originais e a saída anulada fica
no histórico. Para corrigir uma saída, anule e registe novamente os dados certos.
Saídas antigas sem histórico completo de posições exigem reconciliação prévia;
a aplicação não presume uma localização para repor esse stock.
