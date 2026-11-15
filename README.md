# LexTale — PWA Modular

Estrutura limpa do projeto para rodar no navegador e instalar no celular sem limite de tamanho:

- `index.html`: tela principal responsiva para celular.
- `style.css`: tema escuro com destaque dourado e balão de tradução posicionado abaixo da palavra.
- `app.js`: motor de leitura clicável, barra segmentada de áudio com vozes distintas e importador de lições.
- `manifest.json` e `sw.js`: configuração de PWA para instalar na tela inicial do celular.
- `lessons/starter-lessons.json`: lições iniciais em formato separado (basta adicionar novas lições via botão **+ Importar** ou editar este arquivo).

## Como colocar no ar de graça
1. Crie um repositório no GitHub chamado `lextale` e envie todos os arquivos desta pasta.
2. Ative o **GitHub Pages** em *Settings → Pages* (branch `main`, pasta `/root`).
3. Abra o link gerado no Chrome do celular e toque em **Adicionar à tela inicial**.
