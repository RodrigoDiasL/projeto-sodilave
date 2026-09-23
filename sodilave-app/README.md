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

### Atualização local e seleção da bomba de refrigeração

O erro `Unknown column 'coolingPump1' in 'INSERT INTO'` significa que o código
está mais atualizado do que a base de dados. Depois de obter este ramo, pare o
servidor de desenvolvimento e execute na pasta `sodilave-app`:

```sh
npm install
npm run db:upgrade
npm run db:check
npm run dev
```

Os comandos de base de dados leem agora os ficheiros `.env` / `.env.local` com a
mesma precedência do Next.js. As variáveis já definidas no ambiente têm prioridade.
Para uma instalação de produção, use `NODE_ENV=production` para carregar a
configuração de produção. `db:upgrade` aplica as migrações pendentes e preserva os
registos existentes. `dev` e `start` verificam a estrutura antes de abrir o servidor;
em alojamentos que executam diretamente `app.js`, execute `db:check` na atualização.

O arranque exige **bomba 1 ou bomba 2** ao finalizar. Um rascunho pode ainda não ter
bomba escolhida, mas nunca pode ter as duas. Submissões de separadores antigos com
ambas as caixas assinaladas são rejeitadas no servidor. Rascunhos antigos com as
duas flags precisam de uma escolha explícita: não se presume qual bomba funcionava.

### MySQL no Windows e mapa de stock

`db:check` e `db:upgrade` respeitam agora `lower_case_table_names` do servidor:
`weeklystartup` corresponde a `WeeklyStartup` nos modos 1/2, enquanto o modo 0
mantém a distinção necessária no Linux. Os comandos indicam o nome da base e o
modo usado, sem mostrar credenciais. O CI executa os fluxos em MySQL nos modos 0 e 1.

A verificação inclui `StorageLocation`, `ProductionStorageBalance` e
`ProductionStorageMovement`. Se faltar a estrutura do mapa, `npm run db:upgrade`
aplica a migração `2026-09-22-stock-map.sql`, incluindo as posições dos armazéns.
Execute `npm run db:check` a seguir. Não é necessário apagar ou recriar a base.

Os ícones de garrafões são importados pelo componente `MachineIcon` e incorporados
na compilação com um URL próprio. O mesmo componente é usado no arranque,
produção, check-ups, painel e lista de máquinas; inclui um ícone alternativo se a
imagem não carregar.


### Produção passada e verificações do turno

Após atualizar o ramo, execute `npm run db:upgrade` e `npm run db:check` antes de
iniciar a aplicação. A migração `2026-09-23-past-production-and-shift-purges.sql`
adiciona a definição global e os três campos de purga; os registos antigos mantêm
esses campos como não registados.

Em **Controlos de Administrador → Definições de operação**, ative **Permitir
registo de produção passada**. A opção vem desligada por defeito e aplica-se a
colaboradores, responsáveis de produção e administradores. Quando ativa, o
seletor de dia e turno surge junto da data atual no registo de produção. Apenas
turnos terminados são aceites. Desativar impede novos registos e a conclusão de
rascunhos de turnos passados; mantém as consultas e as permissões existentes de
correção de produções já finalizadas.

As verificações gerais e das máquinas são gravadas numa única operação. A
confirmação do segundo trabalhador surge uma vez, no fim do formulário. Fechar
uma secção de máquina mantém os valores preenchidos. Uma validação falhada não
finaliza parte das verificações nem guarda a confirmação do colega.

### Segurança e atualização de sessões

Consulte [SECURITY.md](./SECURITY.md) para as constatações, correções, limites e
configuração da auditoria de 23/09/2026. Esta atualização exige `npm ci`,
`npm run db:upgrade` e `npm run db:check`. As sessões antigas são invalidadas;
os utilizadores devem voltar a introduzir o PIN. A alteração de PIN, perfil ou
estado de acesso também termina as sessões desse utilizador.

`APP_URL` tem de corresponder à origem HTTPS usada no navegador em produção.
Os testes adicionais são `npm run audit:security` e, após compilar e com uma base
de testes configurada, `npm run test:http`. Não usar a base operacional nos testes
SQL de integração: estes apagam os dados da base descartável.

## Ecrã da zona de produção e ordens de paletização

Depois de atualizar o código, executar `npm run db:upgrade` e `npm run db:check`.
A migração `2026-09-24-production-display.sql` acrescenta apenas as tabelas de
emparelhamento dos ecrãs e de ordens por máquina; mantém os dados existentes.

1. Em **Administração → Ecrã de produção**, definir o produto/lote comercial ativo,
   destino **Paletes** ou **Estiba / monte** e, opcionalmente, instruções para cada
   máquina. O produto deve estar associado à máquina no catálogo.
2. As ordens pertencem ao ciclo semanal ativo. Confirmar novas ordens depois de um
   novo arranque semanal e sempre que mudar o produto ou o lote comercial.
3. No mesmo menu, dar um nome ao monitor e gerar um código. Abrir o endereço da
   aplicação seguido de `/display` no navegador da TV, ou num computador/mini-PC
   ligado ao monitor por HDMI. Introduzir o código de 8 algarismos dentro de 10
   minutos; só pode ser usado uma vez.
4. Selecionar **Ecrã completo** (ou F11). Desativar a suspensão/protetor de ecrã no
   dispositivo. O navegador precisa de acesso à mesma aplicação/rede. O endereço
   local do computador de desenvolvimento não é acessível noutra TV através de
   `localhost`; usar um endereço acessível à TV. Em produção, servir por HTTPS.

A comunicação usa pedidos HTTPS à própria aplicação a cada 10 segundos, sem um
serviço externo. A credencial da TV é independente da sessão de utilizador, apenas
permite consultar este painel e expira ao fim de 90 dias. Pode ser revogada no menu
administrativo; o ecrã bloqueia na atualização seguinte. Para voltar a ligar,
gerar outro código. Não colocar credenciais de administrador na TV.

São mostradas apenas as máquinas ativas em funcionamento dentro de um ciclo
semanal aberto. A máquina 7 aparece em último, ocupando a largura disponível.
O painel identifica o **lote previsto** quando ainda não há registo no turno e o
**lote registado neste turno** quando já existe. Não usa produções de turnos
anteriores nem registos cancelados. Uma alteração da regra de lote da máquina também substitui o lote anterior pelo
novo código previsto, mesmo dentro do mesmo turno. O código previsto usa a mesma regra da criação
de produção, mas não reserva um lote nem substitui o registo/validação de qualidade.
Se a ordem não corresponder ao produto/lote registado, ou se o lote comercial tiver
sido fechado, é apresentado um aviso e a instrução de destino fica suspensa até
ser corrigida. Ao perder ligação, ultrapassar 30 segundos sem atualização ou mudar
de turno sem dados novos, o ecrã oculta as instruções e pede confirmação ao responsável.

## Corrigir a localização física no mapa

O administrador seleciona uma posição ocupada e usa **Corrigir localização física**
para transferir todos os lotes para uma posição livre do mesmo tipo, indicando o
motivo. Pode corrigir entre armazéns. A operação é atómica, preserva as quantidades e
regista cada movimento e o utilizador na auditoria. Não junta duas estibas ocupadas.
Para mover apenas parte de um lote, continuam disponíveis os controlos individuais
**Corrigir / mover**. Se o stock tiver mudado entretanto (por exemplo, por expedição),
a alteração é rejeitada e é necessário atualizar o mapa antes de confirmar.
