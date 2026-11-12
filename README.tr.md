# MachCode ⚡

**MachCode**, yalnızca **NVIDIA NIM API** (`integrate.api.nvidia.com/v1`) altyapısına özel olarak geliştirilmiş, paralel model yarıştırma (parallel streaming racing) ve anlık akış devri (handoff) yeteneklerine sahip ultra hızlı, terminal tabanlı yapay zeka kodlama asistanıdır.

[![CI](https://github.com/gokaykrbs/MachCode/actions/workflows/ci.yml/badge.svg)](https://github.com/gokaykrbs/MachCode/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)
[![Node Version](https://img.shields.io/badge/node-%3E%3D18.0.0-blue.svg)](https://nodejs.org/)
[![NVIDIA NIM](https://img.shields.io/badge/NVIDIA-NIM%20Build-76B900?logo=nvidia&logoColor=white)](https://build.nvidia.com)

---

## 🚀 Öne Çıkan Özellikler

- 🏎️ **Paralel Model Yarışı (Parallel Streaming Racing):** Bir istem gönderildiğinde birden çok frontier NVIDIA NIM modeli (Llama 3.1 405B/70B, DeepSeek R1, Mixtral vb.) aynı anda stream başlatır; ilk anlamlı token üreten model yarışın bayrağını alır ve gecikmeyi minimuma indirir.
- 🛡️ **Antigravity & Claude Code Tarzı Yetkilendirme (Permissions):** Dosya yazma, düzenleme ve terminal komutlarında kullanıcıya renkli diff önizleme kartları sunulur (`[Y/n/a/d]`). Yıkıcı komutlar (`rm -rf`, `git push --force`) asla atlanamaz ve insan onayı gerektirir.
- 🧩 **Model Context Protocol (MCP) Desteği:** `@modelcontextprotocol/sdk` protokolü ile harici araçlar, SQLite veritabanları, GitHub API ve sunucular doğrudan bağlanabilir (`/mcp` komutu).
- 🔍 **Yüksek Hızlı Regex Kod Arama:** `src/tools/fastSearch.ts` ile tüm çalışma alanında anında çoklu dosya regex taraması (`/search`).
- ⏪ **Çoklu Dosya Snapshot & Rollback:** Kod düzenlemeleri öncesinde çalışma alanı anlık görüntüsü saklanır; tek tuşla geri alınabilir (`/snapshots`).
- 🤖 **Özelleştirilmiş NVIDIA NIM Alt Ajanları (Subagents):** `@architect`, `@coder`, `@tester`, `@reviewer` ve GPU hızlandırma uzmanı `@nvidia`.
- 📊 **Model Kıyaslama Motoru (Benchmark):** NVIDIA NIM modellerinin ilk token gecikmesini (TTFT) ve saniye başına token hızını (TPS) anlık test eder (`/race`).

---

## 📦 Kurulum

### Gereksinimler
- **Node.js**: v18.0.0 veya üstü (v20+ tavsiye edilir)
- **NVIDIA Build API Key**: [NVIDIA Build](https://build.nvidia.com) adresinden ücretsiz temin edilebilir (`nvapi-...`).

### Global Kurulum (NPM)
```bash
npm install -g machcode
# veya pnpm ile
pnpm add -g machcode
```

### Kaynak Koddan Kurulum
```bash
git clone https://github.com/gokaykrbs/MachCode.git
cd MachCode
pnpm install
pnpm run build
pnpm link --global
```

---

## 🔑 Başlarken

İlk çalıştırmada MachCode API anahtarınızı sorar ve `~/.machcode/config.json` içerisine güvenle kaydeder:

```bash
machcode
```

Alternatif olarak ortam değişkeni tanımlayabilirsiniz:
```bash
export NVIDIA_API_KEY="nvapi-your-key-here"
machcode
```

---

## ⚡ Kullanım ve Eğik Çizgi (Slash) Komutları

Terminal arayüzünde 28'den fazla güçlü slash komutu mevcuttur:

| Komut | Açıklama |
| :--- | :--- |
| `/search <desen>` | Çalışma alanında regex tabanlı yüksek hızlı çoklu dosya kod araması |
| `/mcp` | Model Context Protocol sunucularını listele, bağla veya yönet |
| `/race [prompt]` | Modellerin TTFT (ilk token süresi) ve TPS (hız) değerlerini yarıştır ve raporla |
| `/snapshots` | Otomatik oluşturulan çoklu dosya anlık görüntülerini listele ve geri al |
| `/branch <ad>` | Güvenli denemeler için yeni bir Git dalı oluştur ve geçiş yap |
| `/approve [ask\|auto]` | Etkileşimli onay ve otomatik onay modları arasında geçiş yap |
| `/model [id\|reset]` | Belirli bir NVIDIA modeline sabitle veya paralel yarış moduna dön |
| `/session` / `/history` | Aktif oturumu kaydet, incele veya devam ettir |
| `/theme [tema]` | Arayüz temasını değiştir (`nvidia`, `cyberpunk`, `monokai`, `nord`, vb.) |
| `/status` | Çalışma alanı, git durumu ve aktif model havuzunu görüntüle |

---

## 🤖 Özelleştirilmiş NVIDIA NIM Alt Ajanları (Subagents)

MachCode, yalnızca NVIDIA NIM modelleriyle çalışan 5 özelleştirilmiş alt ajan sunar. İstemlerinizde `@<ad>` yazarak doğrudan çağırabilir veya `/agent <ad>` komutuyla oturum boyunca sabitleyebilirsiniz:

| Alt Ajan | Çağrı (@) | Varsayılan Mod | Tercih Edilen NIM Modelleri | Rol ve Yetenekler |
| :--- | :--- | :---: | :--- | :--- |
| **Architect** | `@architect` | `PLAN` | DeepSeek R1, Llama 3.1 405B, Nemotron 70B | Üst düzey sistem mimarisi, RFC yazımı, veritabanı şemaları, modüler sınırlar ve mimari diyagramlar. |
| **Coder** | `@coder` | `BUILD` | Qwen 2.5 Coder 32B, DeepSeek-Coder, Llama 3.3 70B | Cerrahi kod yazımı, temiz git diff üretimi, hata düzeltme ve sıfır sohbet (zero-chatter). |
| **Tester** | `@tester` | `BUILD` | Qwen 2.5 Coder, Mixtral 8x22B, Llama 3.3 70B | Otomatik birim ve entegrasyon testleri, sınır testleri, mock doğrulama ve regresyon testleri. |
| **Reviewer** | `@reviewer` | `PLAN` | DeepSeek R1, Llama 3.1 405B, Nemotron 70B | Sıkı kod kalite kapısı, güvenlik denetimi (OWASP), bellek sızıntısı tespiti ve performans incelemesi. |
| **NVIDIA Specialist** | `@nvidia` | `BUILD` | DeepSeek R1, Llama 3.1 405B, Nemotron 70B | NVIDIA GPU hızlandırma uzmanı (CUDA C++, TensorRT-LLM, cuDF, cuOpt, Triton, DALI, DeepStream). |

---

## 🔒 Güvenlik & İzin Sistemi

MachCode, **Claude Code** ve **Antigravity** izin modelini benimser:

1. **Dosya Değişiklikleri (`edit_file`, `write_file`, `apply_diff`):**
   Model bir dosya değiştirmek istediğinde terminalde renkli satır farkı (diff) kartı gösterilir:
   - `[Y]es`: Değişikliği uygula.
   - `[n]o`: Değişikliği reddet (modele geri bildirim yazılabilir).
   - `[a]lways`: Bu oturum için dosya yazma izinlerini onayla.
   - `[d]iff`: Tam satır farkını ekrana yazdır.

2. **Terminal Komutları (`run_command` / `bash`):**
   Komut çalıştırılmadan önce `[y/a/n]` sorulur.
   - Yıkıcı komutlar (`rm -rf`, `git push --force`, `del /s /f`, `format`) **asla** otomatik onaylanamaz; her zaman açık kullanıcı onayı ister.

---

## 🤝 Katkıda Bulunma

Geliştirme süreci ve topluluk kuralları için lütfen [CONTRIBUTING.md](CONTRIBUTING.md) ve [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) belgelerini inceleyin.

```bash
pnpm install
pnpm run build
pnpm test
pnpm run lint
pnpm run format:check
```

---

## 📄 Lisans

Bu proje [MIT Lisansı](LICENSE) kapsamında lisanslanmıştır.
