# Treageweb

Treageweb har Treage som välkomstsida och samlar länkar till Blankdiss,
Reports och Insider.

Varje projekt ansvarar för att bygga och leverera sin webb till Treageweb.
Treageweb publicerar sedan en gemensam webbplats.

Projektwebbar levereras till `dist/<projektnamn>/`. Treage ligger under
`dist/treage/`, och välkomstsidan länkar vidare till de tre underlagen.

## Utveckling

Kör projektets tester med Node.js:

```sh
node --test tests/*.test.mjs
```
