# Bip Flow — Authentication UX Specification v2

## Status

Referência visual aprovada e implementada para o login administrativo. Esta versão substitui a v1 como direção oficial de interface e movimento.

## Experiência aprovada

- Desktop com painel institucional escuro à esquerda e formulário claro à direita.
- Mensagem principal: **Sua operação, sob controle total.**
- Formulário com o título **Entre na sua conta** e CTA **Entrar no Bip Flow**.
- Grade, órbitas e ondas discretas, com contraste alto e baixa interferência visual.
- Logo oficial do Bip Flow preservada, sem redesenho ou alteração do símbolo.
- As três barras rosas recebem movimento suave e independente para reforçar velocidade e fluxo.

## Movimento da marca

As três barras da logo usam uma camada visual sobre o ativo oficial. O símbolo permanece estável; apenas um brilho direcional percorre cada barra.

| Propriedade | Regra |
|---|---|
| Ciclo | 4,6 segundos |
| Ritmo | Curva suave `cubic-bezier(0.22, 1, 0.36, 1)` |
| Defasagem | 180 ms entre as barras |
| Propriedades animadas | `transform` e `opacity` |
| Amplitude | Baixa, sem deslocar o layout |
| Repetição | Contínua e não agressiva |
| Movimento reduzido | Animação desativada com `prefers-reduced-motion: reduce` |

O ativo raster continua sendo a fonte visual oficial. A camada animada é decorativa, não recebe foco e não adiciona conteúdo ao leitor de tela.

## Desktop

- Painel institucional visível a partir do breakpoint `lg`.
- Formulário centralizado verticalmente, com largura máxima de 448 px.
- CTA neutro escuro; rosa reservado para assinatura, foco e pequenos detalhes.
- Órbitas e ondas permanecem atrás do conteúdo.
- Conteúdo funcional sempre possui prioridade sobre movimento decorativo.

## Mobile

- Painel institucional removido abaixo de `lg`.
- Conteúdo começa no topo para evitar recorte quando o teclado virtual é aberto.
- Margens laterais de 24 px.
- Respeito às safe areas superior e inferior do dispositivo.
- Marca compacta acima do formulário.
- Título reduzido para 28 px em telas compactas e 32 px a partir de `sm`.
- Inputs com 16 px para evitar zoom automático.
- Campos e botão principal com altura mínima de 48 px.
- Nenhuma dependência de hover.
- Nenhuma rolagem horizontal em 360 px ou 390 px.

## Acessibilidade

- Contraste WCAG AA.
- Labels persistentes.
- Erros conectados aos campos com `aria-describedby`.
- Estados críticos anunciados com `role="alert"`.
- Controles de senha possuem nome acessível e `aria-pressed`.
- Alvos de toque com pelo menos 44 px.
- A animação respeita a preferência de redução de movimento.
- Elementos decorativos não entram na árvore de acessibilidade.

## Componentes de implementação

- `AuthShell.vue`: estrutura responsiva e painéis.
- `AuthBrandMark.vue`: ativo oficial e animação das três barras.
- `AuthField.vue`: campo, label, erro e controle de senha.
- `AuthSubmitButton.vue`: ação principal e estado de carregamento.
- `AuthAlert.vue`: mensagens informativas, de atenção e erro.
- `LoginView.vue`: estados padrão, validação, sessão, rate limit, captcha e MFA.

## Critérios de aceite

1. O desktop corresponde à composição aprovada de dois painéis.
2. As três barras apresentam movimento suave, escalonado e sem layout shift.
3. `prefers-reduced-motion` interrompe todas as animações decorativas.
4. O painel institucional não aparece no mobile.
5. O login permanece utilizável em 360 × 740 e 390 × 844.
6. Inputs mantêm fonte de 16 px e ações possuem pelo menos 44 px.
7. Não existe overflow horizontal.
8. Autenticação, MFA, captcha e contratos de API permanecem inalterados.
9. Typecheck, lint, testes unitários, Cypress de autenticação e build devem permanecer verdes.

## Fora do escopo

- Alterações no backend.
- Mudanças em autenticação, tokens, cookies ou RBAC.
- Redesenho da vitrine.
- Animação da logo em páginas que não utilizam o shell de autenticação.
- Publicação, merge ou deploy sem gate separado.
