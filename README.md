# Vou pra Missa — código do site

Site estático (sem servidor, sem banco de dados) que o GitHub publica de graça.
Você edita **planilhas (CSV)**; o site é gerado automaticamente.

## Onde fica cada coisa

| Arquivo | Para que serve |
|---|---|
| `dados/igrejas.csv` | Uma linha por igreja (nome, bairro, região, diocese, endereço, telefone...) |
| `dados/horarios.csv` | Uma linha por horário (missa, confissão, secretaria, adoração) |
| `dados/regioes.json` | Estados, regiões e o menu de regiões |
| `dados/banners.json` | Anunciantes (imagem + link por posição) |
| `dados/config.json` | Nome, WhatsApp, e-mail, domínio, e a chave **lancado** |
| `assets/` | Visual (`style.css`), comportamento (`app.js`), ícone |

## Cadastrar uma igreja

1. Em `igrejas.csv`, crie uma linha nova. O `id` precisa ser único (ex.: `dsmp-014`).
2. A `regiao` deve ser **exatamente** um nome da lista do estado em `regioes.json` (ex.: `Zona Leste`).
3. Em `horarios.csv`, uma linha por horário, usando o mesmo `id` em `id_igreja`:
   - `tipo`: `missa`, `confissao`, `secretaria` ou `adoracao`
   - `dias`: `dom`, `seg-sex`, `ter,qui`, `qua e sex`, `todos`
   - `hora`: `19:30` ou, para faixas, `16:00-18:00`
4. Quando os dados forem reais, deixe `exemplo` **vazio** e preencha `confirmado_em` (`2026-10-14`).
5. Salve. O site se atualiza sozinho em 1 a 2 minutos.

O gerador avisa, em português, se algo estiver errado (região inexistente, dia ilegível, id repetido).
Abra a aba **Actions** do GitHub para ver os avisos de cada publicação.

## Fotos, padres e selo de confirmação

**Fotos da paróquia**
1. Reduza cada foto para cerca de 1200 px de largura e até ~300 KB (o gerador avisa se passar de 600 KB).
2. Envie para a pasta `assets/fotos/<id-da-igreja>/` (ex.: `assets/fotos/dsmp-040/fachada.jpg`).
3. Em `igrejas.csv`, na coluna `fotos`, liste os caminhos separados por `;`
   (ex.: `assets/fotos/dsmp-040/fachada.jpg;assets/fotos/dsmp-040/altar.jpg`). A primeira vira a capa.
   Sem fotos, a página mostra o convite "Enviar fotos". Peça autorização da paróquia e de quem fotografou.
4. Se o nome do arquivo estiver errado, o gerador avisa em português.

**Quem conduz a paróquia** (coluna `clero`): `Pároco: Pe. Fulano; Vigário paroquial: Pe. Ciclano; Reitor: Pe. Tal; Diácono: Fulano`.
O cargo vem antes dos dois pontos e pode ser qualquer um. Use só nomes e cargos já públicos, sem telefone ou contato pessoal.

**Selo de horário confirmado** (coluna `confirmado_em`, formato `2026-10-14`):
- com data recente: selo verde "Horário confirmado em 14/10/2026"
- confirmado há mais de 120 dias: selo âmbar pedindo reconfirmação
- sem data: selo cinza "a confirmar"
O gerador lista, a cada publicação, as paróquias com confirmação acima de 90 dias.

## "Missa hoje"

Os horários da semana ficam gravados no site; o navegador de quem acessa calcula na hora, no fuso de São Paulo:
- tem missa ainda hoje → **Missa hoje · 19h30**
- já passou ou não tem hoje → **Amanhã · 07h** ou **Próxima: qui · 19h30**

Feriados e datas especiais ainda não são tratados (aparece o aviso para confirmar com a paróquia).

## Publicar no GitHub (uma vez)

1. Crie o repositório `voupramissa` (público) e envie **todos** os arquivos desta pasta, inclusive a pasta `.github`.
   Se o envio pelo navegador não levar a pasta `.github`, crie o arquivo manualmente: *Add file → Create new file*,
   nome `.github/workflows/publicar.yml`, e cole o conteúdo do arquivo de mesmo nome deste pacote.
2. Em **Settings → Pages**, em *Source* escolha **GitHub Actions**.
3. Aba **Actions**: aguarde o fluxo "Publicar site" ficar verde. O endereço aparece em Settings → Pages.
4. Endereço `usuario.github.io/voupramissa`? Em `dados/config.json` coloque `"basePath": "/voupramissa"` (só afeta a página 404).

## Domínio próprio (voupramissa.com.br)

1. Em `config.json`: `"usarDominioProprio": true`.
2. Em Settings → Pages → *Custom domain*, informe `voupramissa.com.br` e siga as instruções de DNS do registro.br.

## Antes de lançar para o público

- [ ] Trocar o WhatsApp e o e-mail em `config.json`
- [ ] Substituir os dados de exemplo pelos reais (e remover `exemplo=sim`)
- [ ] Mudar `"lancado": true` (libera o Google e remove a faixa "Versão de testes")
- [ ] Revisar o texto da página de Privacidade
- [ ] Combinar com a diocese o uso da lista de paróquias

## Conferir no computador

`node build.mjs --preview` gera a pasta `dist-preview/`; abra `dist-preview/index.html` no navegador.

## Planilha única (Excel)

O site lê `dados/vou-pra-missa.xlsx` (abas **Leia-me**, **Igrejas** e **Horarios**). Só entram no site as igrejas com `publicar = SIM`. Se nenhuma estiver marcada, o site usa os dados de exemplo em `dados/igrejas.csv`. Horas podem ser `19:30`, `19h30` ou células de hora do Excel; datas podem ser `15/10/2026`.
