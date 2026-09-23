# Auditoria de segurança — 23 de setembro de 2026

Âmbito: código do ramo `refactor/remove-prisma`, dependências instaladas, ações
servidor, sessões, base SQL, cópias de segurança e servidor de produção local.
Não foram feitos ataques à instalação da Sodilave, nem inspecionados o alojamento,
a firewall, os utilizadores SQL, o TLS ou os backups reais. Isto não constitui uma
certificação nem uma garantia de ausência de vulnerabilidades.

## Constatações e correções

| Prioridade | Constatação | Correção |
| --- | --- | --- |
| Crítica nas dependências | Next.js 15.5.21 e dependências transitivas sinalizados pelo npm: 1 pacote crítico e 3 altos. A exploração dos avisos críticos depende da plataforma e das funcionalidades usadas; não foi tentada. | Next.js / @next/env 15.5.26, PostCSS 8.5.28, sharp 0.35.4 e nanoid 3.3.18. Auditoria final sem avisos conhecidos. |
| Alta | Login apenas por PIN sem limite de tentativas; a confirmação de colega também permitia tentativas repetidas. | Contadores SQL partilhados entre processos: 30 logins/minuto globalmente; 5 confirmações/minuto por operador e por colega. Reserva antes da validação, sem reposição quando uma operação falha. |
| Alta | Cookies JWT copiados continuavam utilizáveis após sair ou mudar PIN; reativar uma conta podia reativar sessões antigas. | Sessões revogáveis no servidor, versão de credenciais, expiração e validação estrita de JWT. Logout revoga a sessão; mudança de PIN/perfil/estado revoga todas as sessões e confirmações de turno. |
| Média | Criação simultânea de contas podia atribuir o mesmo PIN; entradas maiores que 8 dígitos eram truncadas. | Exclusão mútua SQL para alterações de credenciais e validação sem truncagem. O reset pela linha de comandos usa a mesma proteção. |
| Média | CSP permitia qualquer script inline. | Nonce aleatório por resposta e `strict-dynamic`; páginas renderizadas por pedido. CSS inline permanece permitido para os estilos existentes. |
| Média / defesa adicional | Validação da origem dependia exclusivamente do framework. | Rejeição de mutações sem origem, de outra origem ou marcadas como cross-site. `APP_URL` define a origem de produção; a autorização continua em cada ação. |
| Média | Verificação do estado de máquinas e duplicações fora de bloqueios podia ficar desatualizada entre pedidos concorrentes. | Bloqueios e nova validação dentro da transação para produção, arranque intermédio e ocorrências. Máquina de um registo existente não pode ser trocada. Datas futuras/fora do ciclo são rejeitadas nas ocorrências. |
| Média | Cancelamentos de verificações podiam competir com gravações; configurações de produtos/regras podiam ficar parcialmente alteradas após erro. | Ordem consistente de bloqueios e alterações atómicas. Confirmação de colega é gravada juntamente com o registo válido. |
| Reforço | Queries de leitura usavam escape do cliente, sensível ao modo SQL; filtros vazios em operações individuais podiam atingir mais dados. | Prepared statements também nas leituras e rejeição de identificadores vazios. Teste explícito com `NO_BACKSLASH_ESCAPES`. |
| Reforço | Fila SQL ilimitada, pedidos sem limite explícito e backups parciais com extensão de backup completo. | Fila de 32, ligação 5 s, query 15 s, espera de bloqueio 5 s, cache de 256 statements por ligação, ações de 512 KB. Backups temporários privados, renomeados após sucesso, fora das pastas publicadas. |
| Reforço | Cópias locais de produção usavam a mesma chave entre utilizadores/turnos; armazenamento bloqueado podia impedir a submissão. | Chaves por utilizador e turno e tolerância a falhas do armazenamento local. PINs e cookies de sessão não são guardados nesses rascunhos. |

## Verificação

- Testes SQL reais: operações existentes, permissões, tentativas simultâneas,
  revogação e repetição de tokens, alteração de PIN, PIN duplicado, injeção SQL
  com modos de escape diferentes, atomicidade e produção concorrente.
- Testes de backups com ferramenta de exportação simulada: falha sem arquivo
  parcial, sucesso com modo `0600`, rejeição de pasta pública.
- Testes HTTP sobre o servidor compilado: nonce correspondente a todos os scripts,
  rotação do nonce, cabeçalhos, cache, origem e redirecionamento sem autenticação.
  A otimização da imagem da máquina continua funcional após atualizar sharp.
- CI com MySQL 8.4 em `lower_case_table_names=0` e `1`, TypeScript, compilação,
  auditoria npm e testes HTTP. Os testes usam exclusivamente bases descartáveis.

## Atualização e operação

1. Parar a aplicação, obter o ramo e executar `npm ci`.
2. Executar `npm run db:upgrade` e `npm run db:check`.
3. Em desenvolvimento, `npm run dev`. Em produção, validar `APP_URL` HTTPS e
   `SESSION_SECRET` aleatório, executar `npm run build:production` e reiniciar.
4. As sessões anteriores à atualização deixam de ser aceites: iniciar sessão novamente.

O limite global protege sem confiar em cabeçalhos fornecidos pelo cliente. Pode
ser configurado `TRUSTED_PROXY_IP_HEADER=x-real-ip` **apenas** se o proxy substituir
esse cabeçalho e impedir acesso direto ao servidor. Isto acrescenta 10 tentativas
por IP/minuto. Um cabeçalho encaminhado arbitrário não é uma identidade fiável.

O limite global pode afetar novos logins durante um ataque; as sessões existentes
continuam utilizáveis. Proteção de volume no proxy/firewall e monitorização do
alojamento continuam necessárias. A aplicação mantém PINs de 8 dígitos por
compatibilidade operacional; autenticação mais forte para administradores é uma
melhoria futura. As cópias locais são dados do dispositivo, não um cofre encriptado.

Os overrides transitivos são intencionais e devem ser revistos nas atualizações do
Next.js. `npm run audit:security` está no CI para detetar novos avisos. O resultado
sem avisos refere-se à base de vulnerabilidades disponível nesta data.

Fontes oficiais consultadas:
- https://nextjs.org/blog/august-2026-security-release
- https://nextjs.org/blog/nextjs-security-update-september-22-2026
- https://nextjs.org/docs/app/guides/content-security-policy

### Ecrãs de produção e correções de posições (2026-09-23)

- Emparelhamento de uma utilização, código aleatório de 8 algarismos válido por
  10 minutos e limite partilhado de 10 tentativas/minuto. A base de dados guarda
  apenas SHA-256 do código e da credencial aleatória de 256 bits.
- Cookie próprio HttpOnly/Secure/SameSite=Strict; acesso de consulta apenas ao
  endpoint do painel, expiração de 90 dias e revogação administrativa. A credencial
  não é colocada em URLs, armazenamento JavaScript ou registos de auditoria.
- Endpoint sem cache e sem dados pessoais, PINs, clientes ou quantidades de stock.
  A TV oculta as instruções quando perde ligação ou quando os dados ficam antigos.
- Correções de localização exigem administrador, motivo, stock esperado e transação
  SQL. Reenvios e stock alterado são rejeitados; destino ocupado não é misturado.
- Testes adicionais cobrem emparelhamento concorrente/repetido/expirado/revogado,
  permissões, mudança de turno, lotes fechados/cancelados, movimentos concorrentes,
  conservação do stock e acesso HTTP anónimo/forjado. A configuração física da TV,
  do router, de HTTPS e do modo quiosque depende do equipamento da empresa.
