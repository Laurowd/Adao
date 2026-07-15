# Adão

[![Status da CI](https://github.com/Laurowd/Adao/actions/workflows/ci.yml/badge.svg)](https://github.com/Laurowd/Adao/actions/workflows/ci.yml)
[![Licença MIT](https://img.shields.io/badge/licen%C3%A7a-MIT-blue.svg)](LICENSE)

[English](README.md) | Português

Adão é uma CLI local-first para projetos que usam `AGENTS.md`. Ela examina um
projeto, verifica se suas instruções ainda correspondem às evidências locais,
gera contexto determinístico, prepara um prompt estruturado para uma revisão
separada por IA e aplica atualizações gerenciadas com segurança.

## Por que o Adão existe

Agentes de código dependem de instruções corretas sobre o projeto. Um
`AGENTS.md` desatualizado, vago ou grande demais pode indicar comandos
inexistentes, descrever a stack errada ou consumir contexto sem ajudar.

O Adão transforma evidências já presentes em um repositório em um fluxo
repetível: inspecionar o projeto, diagnosticar instruções suspeitas, gerar uma
base conservadora, opcionalmente preparar as evidências para uma revisão externa
por IA e atualizar apenas o conteúdo gerenciado pelo Adão quando os marcadores
estão presentes.

## Início rápido

O Adão requer Node.js 18 ou mais recente. O pacote está preparado como
`@laurowd/adao`, mas **ainda não foi publicado no npm**. Para usar a versão atual
a partir de um checkout:

```bash
git clone https://github.com/Laurowd/Adao.git
cd Adao
npm ci
npm run build
node dist/cli.js --help
```

Os comandos planejados abaixo se aplicam somente **depois que o pacote for
publicado**:

```bash
npm install -g @laurowd/adao
npx @laurowd/adao --help
```

Os cinco comandos de projeto cobrem partes diferentes do fluxo:

| Comando | Finalidade |
| --- | --- |
| `scan` | Inventariar evidências do projeto, como linguagens, scripts, ferramentas e estrutura. |
| `doctor` | Verificar se o `AGENTS.md` atual ainda é consistente com as evidências detectadas. |
| `generate` | Imprimir uma base determinística de `AGENTS.md` derivada de evidências locais. |
| `suggest` | Montar um prompt estruturado para uma revisão separada por Codex, ChatGPT ou outra IA. |
| `apply` | Visualizar e gravar com segurança o conteúdo gerenciado gerado. |

A partir de um checkout de desenvolvimento:

```bash
npm run dev -- scan .
npm run dev -- doctor .
npm run dev -- generate .
npm run dev -- suggest .
npm run dev -- apply .
```

## Comandos

O contrato atual da CLI é:

```text
adao scan <projectPath> [--json]
adao doctor <projectPath> [--json]
adao generate <projectPath>
adao suggest <projectPath> [--json]
adao apply <projectPath> [--yes]

adao --help
adao --version
```

`scan`, `doctor` e `suggest` aceitam saída JSON opcional. `apply` pede
confirmação, exceto quando `--yes` é fornecido. Uso inválido termina com código
`2`; falhas operacionais e um resultado de `doctor` com erros terminam com
código `1`. Erros normais de uso e operação são concisos e não imprimem stack
traces.

Cada comando também possui ajuda específica, por exemplo
`adao apply --help`.

### `scan`

`scan` lê a árvore do projeto e coleta evidências que incluem:

- nome do projeto, descrição do pacote e resumo derivado localmente;
- linguagens detectadas pelas extensões dos arquivos;
- um conjunto conservador de frameworks e ferramentas detectados nos metadados
  do pacote;
- scripts do pacote e evidências do gerenciador de pacotes;
- arquivos importantes e diretórios relevantes do projeto;
- presença de `README.md`, metadados Git e `AGENTS.md`.

A saída textual padrão resume o scan; `--json` expõe o resultado estruturado
completo, incluindo os campos de descrição do pacote e resumo derivado.

```bash
adao scan .
adao scan . --json
```

Por padrão, o scanner examina até 5.000 entradas do filesystem e informa quantas
entradas inspecionou, se o limite foi atingido e quais caminhos não puderam ser
lidos. As saídas textual e JSON expõem se o resultado está completo. Um scan
truncado ou um erro bloqueante de filesystem torna as evidências incompletas;
`doctor` relata essa condição como erro, enquanto `generate`, `suggest` e `apply`
se recusam a continuar a partir de evidências parciais.

A completude do scan se refere à completude da travessia do filesystem. Isso não
significa compreensão universal de todo framework, pacote aninhado ou arquitetura
do projeto. A versão atual lê metadados de dependências somente do `package.json`
da raiz e não agrega arquivos `package.json` aninhados.

A detecção é deliberadamente finita, não universal. A detecção de linguagens se
baseia em extensões, e a de frameworks e ferramentas reconhece um conjunto
definido de dependências de pacote.

### `doctor`

`doctor` valida o `AGENTS.md` atual contra as evidências detectadas no projeto e
relata problemas como `error`, `warning` e `info`, seguidos de um status
`healthy`, `needs attention` ou `broken`.

```bash
adao doctor .
adao doctor . --json
```

As verificações atuais cobrem casos como:

- `AGENTS.md` ausente;
- comandos de pacote que não correspondem aos scripts disponíveis no
  `package.json`;
- comandos que usam um gerenciador de pacotes incompatível com as evidências
  detectadas;
- declarações de stack que parecem incompatíveis com o projeto detectado;
- orientações vagas e tamanho excessivo do arquivo;
- possível desatualização quando `README.md` ou `package.json` é mais recente;
- conflito simples de gerenciador de pacotes com orientações globais em
  `~/.codex/AGENTS.md`;
- scan incompleto do projeto.

A validação de stack é heurística e conservadora. Ela procura declarações
assertivas de stack e evita tratar orientações negativas ou exemplos claramente
hipotéticos como fatos do projeto. Um lockfile ficar mais recente não torna, por
si só, o `AGENTS.md` desatualizado.

### `generate`

`generate` imprime um rascunho de `AGENTS.md` sem gravar arquivos ou chamar um
serviço externo.

```bash
adao generate .
```

A geração é determinística e usa somente evidências locais, como metadados
validados do `package.json`, `README.md`, scripts do pacote, stack detectada,
evidências do gerenciador de pacotes e estrutura do projeto. A descrição do
pacote tem prioridade no resumo do projeto; caso contrário, o Adão usa conteúdo
útil do README. Quando as evidências disponíveis não são suficientes, ele
registra um `TODO` explícito em vez de inventar objetivo, comando, stack ou
arquitetura.

O conteúdo gerado fica dentro de uma região gerenciada:

```markdown
<!-- adao:start -->

<!-- conteúdo gerado -->

<!-- adao:end -->
```

Esses marcadores permitem que `apply` diferencie o conteúdo gerenciado pelo Adão
do conteúdo manual. A geração é bloqueada quando o scan está incompleto, as
evidências de gerenciador de pacotes entram em conflito ou uma declaração
`packageManager` não suportada não possui lockfile reconhecido que a resolva.

### `suggest`

`suggest` prepara um prompt estruturado em Markdown a partir do scan local, do
resultado atual do doctor, do rascunho determinístico gerado e de uma seleção
conservadora de arquivos de evidência locais.

```bash
adao suggest .
adao suggest . --json
```

Ele **não** chama a OpenAI API, invoca um LLM nem envia arquivos do projeto para
qualquer serviço. O Adão apenas imprime o prompt (ou o retorna como parte do
resultado JSON). Depois, você pode fornecer esse prompt separadamente ao Codex,
ChatGPT ou outra IA para revisão. O próprio Adão não executa essa revisão.

O prompt instrui o revisor a usar somente as evidências fornecidas, preservar os
comandos detectados, evitar detalhes inventados sobre o projeto e usar TODOs
quando faltarem evidências. Os arquivos e o total de evidências do prompt possuem
limites de tamanho, e os truncamentos são indicados no prompt.

### `apply`

`apply` prepara o mesmo conteúdo determinístico de `generate`, mostra o conteúdo
proposto ou um diff e pede confirmação antes de gravar. Use `--yes` somente
quando a confirmação não interativa for intencional.

```bash
adao apply .
adao apply . --yes
```

O comportamento da atualização depende do arquivo existente:

- se `AGENTS.md` não existe, o Adão cria um arquivo com marcadores;
- se existem marcadores válidos do Adão, ele substitui somente a região
  gerenciada e preserva byte a byte o conteúdo anterior e posterior;
- se um `AGENTS.md` legado não possui marcadores, o Adão avisa que o arquivo
  inteiro será substituído e que o conteúdo manual não permanecerá no arquivo
  ativo. Ele pede confirmação e cria um backup antes da substituição;
- marcadores malformados, duplicados ou incompletos são rejeitados.

Nas substituições, o Adão cria o primeiro backup numerado disponível
(`AGENTS.md.bak`, `AGENTS.md.bak.1` e assim por diante) sem sobrescrever backups
anteriores. Ele grava o novo conteúdo em um arquivo temporário no mesmo
diretório, sincroniza e fecha o arquivo, verifica se `AGENTS.md` não mudou desde
a visualização e então renomeia o temporário sobre o destino. Essa é uma
estratégia de substituição atômica em filesystems que oferecem rename atômico no
mesmo diretório; não é uma afirmação de atomicidade absoluta em todo filesystem
ou modo de falha.

O escritor preserva os bits de permissão do arquivo existente, rejeita um
`AGENTS.md` que seja link simbólico, revalida o conteúdo antes da substituição
para reduzir o risco de sobrescrever edições concorrentes e remove seu arquivo
temporário quando uma atualização falha. Evidências inseguras ou incompletas são
rejeitadas antes das etapas de confirmação e escrita.

## Garantias de segurança

- **Local-first:** scan, validação, geração, preparação da sugestão e aplicação
  são executados localmente.
- **Nenhum envio externo:** o Adão não envia arquivos do projeto para serviços
  externos.
- **Geração determinística:** as mesmas evidências aceitas seguem regras locais
  fixas; contexto ausente se torna um TODO.
- **Travessia completa do filesystem obrigatória:** scans truncados ou erros
  bloqueantes de leitura interrompem `generate`, `suggest` e `apply` e são erros
  no `doctor`.
- **Limites do conteúdo manual:** o conteúdo fora de marcadores válidos do Adão
  é preservado byte a byte. Arquivos legados sem marcadores recebem aviso
  explícito de substituição e um backup.
- **Backups não destrutivos:** nomes de backup existentes nunca são reutilizados.
- **Substituição cuidadosa:** escrita em arquivo temporário, renomeação atômica
  no mesmo diretório, preservação de permissões, rejeição de links simbólicos e
  verificações de conteúdo concorrente reduzem o risco de escrita.
- **Nenhuma substituição insegura silenciosa:** marcadores inválidos, evidências
  conflitantes de gerenciador de pacotes, scans incompletos e alterações
  concorrentes detectadas interrompem a atualização.

## Como funciona

1. O varredor do sistema de arquivos ignora diretórios comuns de artefatos gerados
   ou dependências e registra se o scan está completo.
2. O scanner valida os campos relevantes do `package.json` da raiz e deriva um
   conjunto limitado de fatos a partir de nomes de arquivos, metadados do pacote,
   conteúdo do README e estrutura de diretórios.
3. `doctor` compara as instruções atuais com esses fatos usando verificações
   conservadoras.
4. `generate` transforma fatos aceitos em uma base curta e marcada. `suggest`
   reúne essa base e evidências selecionadas em um prompt para um revisor externo.
5. `apply` mostra o próximo arquivo exato e usa o fluxo de escrita protegido
   descrito acima.

O próprio Adão não possui integração de rede ou IA. Somente a ferramenta
escolhida separadamente para receber um prompt de `suggest` executaria uma
revisão por IA.

## Limitações atuais

- As heurísticas atuais são inicialmente otimizadas para projetos Node.js e
  TypeScript, embora o scanner reconheça um conjunto limitado de outras
  extensões e ecossistemas.
- A detecção de stack e ferramentas se baseia em uma lista definida de
  dependências de pacote; ela não identifica todo framework nem infere
  arquiteturas arbitrárias.
- Arquivos `package.json` aninhados não são agregados. Dependências e scripts de
  aplicações ou pacotes aninhados ficam fora da stack detectada na raiz.
- A validação de `AGENTS.md` é conservadora e não consegue compreender por
  completo linguagem natural ou provar que as instruções estão semanticamente
  corretas.
- `suggest` seleciona um conjunto limitado de arquivos de evidência convencionais
  em vez de compreender semanticamente o repositório inteiro.
- Não há LLM embutido, interface gráfica, sistema de plugins, banco de dados ou
  análise semântica automática de todo o projeto.
- `@laurowd/adao` está preparado para publicação no npm, mas ainda não foi
  publicado.

## Desenvolvimento

Instale as dependências travadas e execute as principais verificações:

```bash
npm ci
npm test
npm run build
npm audit
```

A validação do pacote também está disponível localmente:

```bash
npm pack --dry-run
npm run test:package
```

`npm run test:package` gera um tarball real, instala-o em um projeto temporário,
verifica `adao --help`, `adao --version` e `adao scan` e confirma que arquivos e
dependências exclusivos de desenvolvimento não são distribuídos.

O workflow do GitHub Actions atualmente executa a suíte de testes e o build no
Node.js 18 e Node.js 22. Um job separado de empacotamento no Node.js 22 executa
`npm audit`, inspeciona um dry run do pacote npm e então instala e executa o
tarball real.

## Estrutura do projeto

```text
.github/workflows/
  ci.yml                    # testes Node 18/22, build, auditoria e pacote
scripts/
  clean.mjs                 # remove a saída compilada antes do build
  package-smoke.mjs         # empacota, instala e executa o tarball real
src/
  cli.ts                    # despacho, formatação e códigos de saída da CLI
  cliArgs.ts                # parsing estrito de comandos e flags
  packageVersion.ts         # lê a versão da CLI no package.json
  core/
    applyAgents.ts          # regiões gerenciadas, backups e escrita protegida
    detectStack.ts          # detecção de linguagem, ferramentas, estrutura e gerenciador
    diffAgents.ts           # diff por linhas para visualização
    generateAgents.ts       # geração determinística do AGENTS.md gerenciado
    readPackageJson.ts      # parsing e validação dos metadados do pacote
    scanProject.ts          # orquestração do scan e guardas de completude
    suggestAgents.ts        # seleção de evidências e construção do prompt
    types.ts                # tipos de domínio compartilhados
    validateAgents.ts       # regras do doctor e cálculo do status
  utils/
    fs.ts                   # navegação limitada pelo filesystem
    paths.ts                # utilitários de normalização de caminhos
tests/                      # cobertura unitária e dos fluxos da CLI
```

## Licença

[MIT License](LICENSE)
