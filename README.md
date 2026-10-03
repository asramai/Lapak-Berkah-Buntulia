# React + Vite

> Workflow otomatis: setiap perubahan file di folder ini akan di-lint, di-build, di-commit, di-push ke GitHub, lalu di-deploy ke Vercel production secara otomatis oleh `scripts/auto-sync.mjs`.

Perintah yang tersedia:

| Perintah | Fungsi |
| --- | --- |
| `npm run autosync` | Jalankan watcher otomatis (butuh Vercel CLI sudah login) |
| `npm run autosync:once` | Jalankan satu siklus sinkronisasi lalu keluar |
| `node scripts/auto-sync.mjs --no-deploy` |Watcher tanpa deploy ke Vercel |

Target push otomatis adalah `origin` (`asramai/Lapak-Berkah-Buntulia`). Remote `star` (`lapakberkahbuntulia-star/Lapak-Berkah-Buntulia`) masih ada sebagai remote baca, karena akun `asramai` belum punya izin tulis ke sana. Ganti target bila perlu:

```
$env:AUTOSYNC_REMOTE="star"; npm run autosync
```

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and Oxlint's TypeScript related rules in your project.
