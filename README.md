# Revo Manager

Application de gestion commerciale et financière : devis, factures, achats, trésorerie, CRM, rapports.

HTML, CSS et JavaScript, sans étape de compilation.

## Lancer en local

```bash
python3 -m http.server 4173 --bind 127.0.0.1
```

Puis ouvrir http://localhost:4173.

## Données

Les données ne sont pas dans ce dépôt.

- **Sans base configurée** (`js/config.js` vide) : elles restent dans le navigateur utilisé.
- **Avec une base Supabase** : connexion par email et mot de passe, enregistrement automatique,
  mêmes données sur tous les appareils, et une version par jour de modification (30 au maximum).

### Mettre en place la base

1. Créer un projet Supabase.
2. Exécuter `supabase/schema.sql` dans le SQL Editor.
3. Dans Authentication, créer l'utilisateur, puis désactiver les nouvelles inscriptions.
4. Renseigner l'adresse du projet et la clé **publique** dans `js/config.js`.

Ne jamais ajouter au dépôt une sauvegarde, un export CSV ou l'image du cachet.
