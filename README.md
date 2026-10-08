# Treageweb

Treageweb samlar och publicerar de statiska webbplatserna från Treages projekt.
Varje källrepo äger sin byggprocess och skriver sin färdiga webbplats till en
egen katalog under `site/`. Treageweb publicerar hela katalogen med GitHub Pages
varje dag klockan 21:00 svensk tid. Publicering kan också startas manuellt.

## Struktur

```text
site/
├── index.html       # Gemensam ingång
├── blankdiss/       # Byggs och uppdateras av Blankdiss
└── insider/         # Reserverad för Insider
```

Källrepona använder en fine-grained personal access token som Actions-secret
`TREAGEWEB_TOKEN`. Tokenen behöver `Contents: Read and write` för detta repo.
Blankdiss skriver till `site/blankdiss/`; Insider ska skriva till
`site/insider/` så att respektive publicering bevarar den andra webbplatsen.

Aktivera GitHub Pages i repots inställningar med **GitHub Actions** som
build/deployment source. Workflown `.github/workflows/publish-pages.yml` laddar
upp `site/` vid den schemalagda publiceringen eller vid en manuell körning.

Vid första installationen behöver Treagewebs startfiler först pushas till
`main`, så att branch och Pages-workflow finns på GitHub. Därefter kan
källrepona checka ut Treageweb och uppdatera sina respektive webbplatskataloger.
