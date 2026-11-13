# ⚡ MachCode Kullanım Kılavuzu & Dokümantasyon

<p align="center">
  <strong>NVIDIA NIM Destekli Paralel Akış Yarıştırmalı (Streaming Racing) Yapay Zeka Kodlama ve Soru-Cevap Terminali</strong><br />
  <em>Antigravity / Claude Code / OpenCode standardında, 57+ NVIDIA NIM modeliyle (21+ AI sağlayıcısı) eşzamanlı yarışan, çift modlu (Plan & Build), cerrahi kod düzenleme ve geri alma yeteneklerine sahip açık kaynak CLI.</em>
</p>

<p align="center">
  <a href="README.tr.md">🇹🇷 Türkçe Kullanım Kılavuzu</a> | <a href="README.md">🇬🇧 English Documentation</a>
</p>

<p align="center">
  <a href="https://github.com/gokaykrbs/MachCode/releases"><img src="https://img.shields.io/badge/version-v0.1.0-blue.svg?style=flat-square" alt="version" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green.svg?style=flat-square" alt="License: MIT" /></a>
  <a href="https://github.com/gokaykrbs/MachCode/actions"><img src="https://img.shields.io/badge/tests-109%2F109%20passing-brightgreen.svg?style=flat-square" alt="Tests Passing" /></a>
  <a href="https://build.nvidia.com"><img src="https://img.shields.io/badge/NVIDIA%20NIM-57%2B%20Models-76B900.svg?style=flat-square&logo=nvidia" alt="NVIDIA NIM" /></a>
  <a href="#"><img src="https://img.shields.io/badge/TypeScript-5.6%20Strict-blue.svg?style=flat-square&logo=typescript" alt="TypeScript" /></a>
</p>

---

## 📑 İçindekiler
1. [Giriş ve Mimari Felsefe](#-giriş-ve-mimari-felsefe)
2. [Kurulum ve Hızlı Başlangıç](#-kurulum-ve-hızlı-başlangıç)
3. [Çalışma Modları: Plan & Build](#-çalışma-modları-plan--build)
4. [Paralel Model Yarışı (Streaming Racing) ve Adil Dengeleme](#-paralel-model-yarışı-streaming-racing-ve-adil-dengeleme)
5. [Model Seçimi ve Yönlendirme Komutları](#-model-seçimi-ve-yönlendirme-komutları)
6. [NVIDIA Uzman Alt Ajanları (Subagents)](#-nvidia-uzman-alt-ajanları-subagents)
7. [Cerrahi Kod Düzenleme, Onay Kapısı ve Geri Alma (Snapshot)](#-cerrahi-kod-düzenleme-onay-kapısı-ve-geri-alma-snapshot)
8. [Oturum Yönetimi & Dayanıklılık (Sessions)](#-oturum-yönetimi--dayanıklılık-sessions)
9. [NVIDIA Resmi Ajan Becerileri ve MCP Köprüsü](#-nvidia-resmi-ajan-becerileri-ve-mcp-köprüsü)
10. [Tüm Slash (/) Komutları Referansı](#-tüm-slash--komutları-referansı)
11. [Sıkça Sorulan Sorular & Sorun Giderme](#-sıkça-sorulan-sorular--sorun-giderme)

---

## 💡 Giriş ve Mimari Felsefe

Geleneksel terminal kodlama araçları tek bir modele (örneğin sadece Claude veya sadece GPT-4) bağlı kalır. Bu durum API kuyruk gecikmelerine, soğuk başlangıç (cold start) beklemelerine ve modelin halüsinasyon riskine yol açar.

**MachCode**, doğrudan **NVIDIA Build (NIM)** altyapısına bağlanır ve API anahtarınızdaki tüm üretken modelleri (Moonshot Kimi K3.1/K2.6, DeepSeek R1/V3, Qwen 2.5 Coder 32B, Meta Llama 3.1 405B, NVIDIA Nemotron 70B/340B ve 20'den fazla küresel sağlayıcı) aynı anda paralel akış yarışına (**Streaming Handoff Racing**) sokar.

```text
                             Kullanıcı İstemi / Görev
                                        │
                                        ▼
             [Paralel Model Yarışı: StrongPool (57+ NVIDIA NIM Modeli)]
    (Moonshot Kimi K3.1, DeepSeek R1, Qwen Coder, Llama 3.1 405B, Nemotron...)
                                        │
         ┌──────────────────────────────┴──────────────────────────────┐
         │ İlk Model Gerçek İçerik Token'ı Üretir (200 OK)             │ Hata / 10s Timeout
         ▼                                                             ▼
[Anında Kilitlenme & Temiz Akış]                             [WeakPool Yedek Yarışı]
• Düşünce zincirini <plan> içine alır                        • Hızlı modellerle yedek yarış
• Kazanan modele kilitlenir ve ekrana basar                  • Kullanıcı asla cevapsız kalmaz
• Kalan 56 asılı HTTP akışını anında iptal (abort) eder
```

---

## 📦 Kurulum ve Hızlı Başlangıç

### Ön Gereksinimler
- **Node.js**: `v18.0.0` veya üstü (v20+ önerilir)
- **Paket Yöneticisi**: `npm` veya `pnpm`
- **NVIDIA Build API Anahtarı**: [NVIDIA Build](https://build.nvidia.com) adresinden ücretsiz temin edebilirsiniz (`nvapi-...`).

### 1. Global Kurulum
```bash
# NPM ile doğrudan kurulum
npm install -g machcode

# Veya kaynak koddan kurulum
git clone https://github.com/gokaykrbs/MachCode.git
cd MachCode
pnpm install
pnpm run build
pnpm link --global
```

### 2. API Anahtarını Yapılandırma
MachCode'u herhangi bir terminalden `mach` veya `machcode` yazarak başlatın:

```bash
mach
```

İlk açılışta API anahtarınız yoksa interaktif olarak sorulur ve `~/.machcode/config.json` dosyasına kaydedilir. Alternatif yöntemler:
```bash
# Yöntem A: Terminal içerisinden yapılandırma
mach> /config key nvapi-your-key-here

# Yöntem B: Çevre değişkeni tanımlama
export NVIDIA_API_KEY="nvapi-your-key-here"  # Linux / macOS
$env:NVIDIA_API_KEY="nvapi-your-key-here"     # Windows PowerShell

# Yöntem C: .env dosyası
cp .env.example .env
```

---

## 🔄 Çalışma Modları: Plan & Build

MachCode iki temel işletim moduna sahiptir. Modlar arasında geçiş yapmak için `Tab` tuşuna basabilir veya `/mode` komutunu kullanabilirsiniz:

```
[PLAN]  --> Salt Okunur Güvenli Mod: Dosyalara dokunmaz, sistemde komut çalıştırmaz.
[BUILD] --> Tam Yetkili Ajan Modu: Dosya oluşturur, cerrahi diff uygular, test koşturur.
```

### 1. Plan Modu (`/mode plan` veya `Tab`)
- **Amacı**: Kod tabanını analiz etmek, mimari tasarlamak veya güvenli soru-cevap yapmak.
- Ajan sadece `read_file`, `list_directory`, `glob` ve `grep` araçlarını kullanabilir.
- Asla dosyalarda değişiklik yapmaz ve kabuk (shell) komutu çalıştırmaz.

### 2. Build Modu (`/mode build` veya `Tab`)
- **Amacı**: Özellik geliştirmek, hata ayıklamak, test yazmak ve dosyaları cerrahi olarak düzenlemek.
- Ajan `edit_file`, `write_file`, `apply_diff` ve `run_command` araçlarını kullanabilir.
- Yapılacak her değişiklik öncesinde diff önizleme kartı gösterilir.

---

## 🏎️ Paralel Model Yarışı (Streaming Racing) ve Adil Dengeleme

### Havuz Mimarisi: StrongPool ve WeakPool
- **StrongPool (Güçlü/Akıl Yürüten Modeller):** `moonshotai/kimi-k3.1`, `moonshotai/kimi-k2.6`, `deepseek-ai/deepseek-r1`, `qwen/qwen2.5-coder-32b-instruct`, `meta/llama-3.1-405b-instruct`, `nvidia/nemotron-4-340b-instruct` gibi 30B+ parametreli veya derin muhakeme yapan modeller.
- **WeakPool (Ultra Hızlı / Yedek Modeller):** `poolside/laguna-xs-2.1`, `minimaxai/minimax-m3.1-flash`, `openai/gpt-oss-20b`, `nvidia/nemotron-3.5-bolt-e4b`.

### Adil Dengeleme ve Handikap Mekanizması
Düşünce modelleri (`Kimi K3.1`, `DeepSeek R1`) token üretmeden önce derin akıl yürütme (`reasoning_content`) yapar. MachCode bu düşünceleri terminale sızdırmamak için arka planda tamponlar. 

Ultra küçük modellerin (`poolside/laguna-xs` gibi) henüz muhakeme tamamlanmadan ilk token'ı basıp zeki modelleri iptal etmesini engellemek için:
1. `laguna-xs`, `bolt-e4b` ve `flash` modelleri **WeakPool**'a atanmıştır.
2. Ağır modellerle yarışa girdiklerinde **1.6 saniyelik adil handikap beklemesi** uygulanır. Böylece Kimi K3.1 ve DeepSeek R1 modellerinin düşüncelerini toparlayıp ilk cevabı vermesine fırsat tanınır.
3. Karmaşık mimari, refactor ve algoritma sorularında (`isHeavyTask`) sistem otomatik olarak Kimi K3.1 ve DeepSeek R1 modellerine öncelik verir.

---

## 🎯 Model Seçimi ve Yönlendirme Komutları

Yarışı beklemeden belirli modellere doğrudan kilitlenmek istediğinizde şu komutları kullanabilirsiniz:

### 1. `/heavy <istemi>` — Doğrudan Ağır/Akıl Yürüten Modele Gönder
Yarışı tamamen baypas eder ve görevi doğrudan havuzun en akıllı modeline (`moonshotai/kimi-k3.1`) devreder:
```bash
mach> /heavy Bu mikroservis mimarisindeki olası race condition risklerini analiz et
```

### 2. `/fast <istemi>` — Hızlı Yanıt Modu
Karmaşık düşünmeye gerek olmayan basit sorularda en hızlı hafif modele (`minimax-flash` / `laguna-xs`) yönlendirir:
```bash
mach> /fast Python'da liste ters çevirme kodunu yaz
```

### 3. `/model [id|reset]` — Belirli Modele Sabitleme
Oturum boyunca tüm sorularınızın tek bir model tarafından cevaplanmasını sağlar:
```bash
# Kimi K3.1 modeline sabitle:
mach> /model moonshotai/kimi-k3.1

# DeepSeek R1 modeline sabitle:
mach> /model deepseek-ai/deepseek-r1

# Qwen Coder modeline sabitle:
mach> /model qwen/qwen2.5-coder-32b-instruct

# Sabitlemeyi kaldır ve paralel yarış moduna geri dön:
mach> /model reset
```

### 4. `/race` — Canlı Hız ve Gecikme Testi (Benchmark)
NVIDIA NIM modellerinin Time-To-First-Token (TTFT) ve Tokens-Per-Second (TPS) değerlerini anlık olarak yarıştırır ve tablo olarak raporlar:
```bash
mach> /race
```

### 5. `/config refresh` — NIM Kataloğunu Canlı Yenile
NVIDIA'nın sunduğu en yeni modelleri API üzerinden çeker ve havuzları otomatik günceller:
```bash
mach> /config refresh
```

---

## 🤖 NVIDIA Uzman Alt Ajanları (Subagents)

MachCode içinde NVIDIA NIM modelleriyle optimize edilmiş 5 uzman alt ajan hazır gelir. Bu ajanları isteminizin başında `@<ad>` yazarak tek seferlik çağırabilir ya da `/agent <ad>` ile oturuma sabitleyebilirsiniz:

| Alt Ajan | Etiket | Mod | Tercih Edilen Modeller | Görev ve Yetkinlikler |
| :--- | :--- | :---: | :--- | :--- |
| **Architect** | `@architect` | `PLAN` | Kimi K3.1, DeepSeek R1, Llama 3.1 405B | Üst düzey sistem mimarisi, RFC yazımı, veritabanı şemaları, modüler sınırlar ve mimari diyagramlar. |
| **Coder** | `@coder` | `BUILD` | Qwen 2.5 Coder 32B, DeepSeek-Coder, Llama 3.3 70B | Cerrahi kod yazımı, temiz git diff üretimi, hata düzeltme ve sıfır sohbet (zero-chatter). |
| **Tester** | `@tester` | `BUILD` | Qwen 2.5 Coder, Mixtral 8x22B, Llama 3.3 70B | Otomatik birim ve entegrasyon testleri, sınır testleri, mock doğrulama ve regresyon testleri. |
| **Reviewer** | `@reviewer` | `PLAN` | DeepSeek R1, Llama 3.1 405B, Nemotron 70B | Sıkı kod kalite kapısı, güvenlik denetimi (OWASP), bellek sızıntısı tespiti ve performans incelemesi. |
| **NVIDIA Specialist** | `@nvidia` | `BUILD` | DeepSeek R1, Nemotron 70B, Llama 3.1 405B | NVIDIA GPU hızlandırma uzmanı (CUDA C++, TensorRT-LLM, cuDF, cuOpt, Triton, DALI, DeepStream). |

**Örnekler:**
```bash
mach> @architect auth servisi için multi-tenant veritabanı şeması tasarla
mach> @coder src/middleware/jwt.ts dosyasındaki token doğrulama mantığını yaz
mach> @tester auth servisi için node:test birim testlerini hazırla
mach> @reviewer src/engine/executor.ts dosyasını güvenlik açıklarına karşı denetle
mach> @nvidia bu matris çarpımı fonksiyonunu CUDA paylaşımlı bellek (shared memory) ile optimize et
```

---

## 🛡️ Cerrahi Kod Düzenleme, Onay Kapısı ve Geri Alma (Snapshot)

### 1. İnteraktif Diff Onay Kapısı
MachCode bir dosyayı değiştirmeden veya yeni bir dosya oluşturmadan önce terminalde satır bazlı renkli diff kartı açar:
```text
══════════════════════════════════════════════════════════════════
  FILE EDIT PROPOSAL: src/config.ts (+3 / -1 lines)
══════════════════════════════════════════════════════════════════
  @@ -12,3 +12,5 @@
  - const timeout = 5000;
  + const timeout = 10000;
  + export const RETRY_COUNT = 3;

[Y]es (uygula) / [n]o (reddet) / [a]ll (tümünü onayla) / [d]iff (detay) ?
```
- Onay politikasını değiştirmek için:
  - `/approve ask` (Varsayılan: Her değişiklikte diff sorar)
  - `/approve auto` (Otomatik uygula: Hızlı denemeler için)

### 2. Çoklu Dosya Geri Alma (Snapshot Rollback)
MachCode her dosya işleminden önce dosyanın eski halini hafızaya alır:
```bash
# Yapılan son değişikliği geri al:
mach> /undo

# Belirli bir dosyadaki tüm AI değişikliklerini geri al:
mach> /undo src/config.ts

# Oturum boyunca yapılan TÜM dosya değişikliklerini sıfırla:
mach> /undo all

# Geçmiş anlık görüntüleri listele:
mach> /snapshots
```

---

## 💾 Oturum Yönetimi & Dayanıklılık (Sessions)

Tüm çalışmalarınız `~/.machcode/sessions/` altında otomatik olarak kaydedilir. Elektrik kesilse veya terminal kapansa bile kaldığınız yerden devam edebilirsiniz:

```bash
# Aktif oturumu kaydet:
mach> /save v1-auth-bitti

# Kayıtlı oturumları listele:
mach> /sessions

# Önceki oturumu geri yükle:
mach> /resume mc_46syblac
mach> /resume latest

# Doğrudan terminalden önceki oturumla başla:
mach --resume
mach --resume v1-auth-bitti
```

### Bağlam Özetleme (Context Summarization)
Oturum uzadığında ve token limiti yaklaştığında, MachCode arka planda akıllı özetleme motorunu çalıştırır. Eski konuşma turlarını otomatik özetleyerek modelin hafızasını korur ve bağlam penceresi taşmalarını (context overflow) önler.

---

## 🧩 NVIDIA Resmi Ajan Becerileri ve MCP Köprüsü

### 1. NVIDIA Official Agent Skills
MachCode, NVIDIA'nın resmi [`NVIDIA/skills`](https://github.com/NVIDIA/skills) deposundaki becerileri otomatik tanır ve modellerin kullanımına sunar:
- `/skills`: Mevcut tüm NVIDIA becerilerini listeler.
- `/cuopt`: Araç rota optimizasyonu, LP ve MILP matematiksel modelleme.
- `/cudf`: GPU DataFrame hızlandırma ve pandas optimizasyonu.
- `/cudaq`: Hibrit kuantum-klasik CUDA-Q programlama.

### 2. Model Context Protocol (MCP) Köprüsü
Proje dizininizdeki `.machcode/mcp.json` dosyası üzerinden harici araçları ve sunucuları bağlayabilirsiniz:
```bash
mach> /mcp list
mach> /mcp reload
```

---

## 📖 Tüm Slash (/) Komutları Referansı

| Komut | Kullanım | Kategori | Açıklama |
| :--- | :--- | :--- | :--- |
| `/ask` | `/ask <soru>` | İcra | Dosya değiştirmeden salt sohbet/soru-cevap yap. |
| `/plan` | `/plan <istemi>` | İcra | Plan Moduna geç veya mimari analiz üret. |
| `/mode` | `/mode [plan\|build]` | İcra | Plan (salt okunur) ve Build (ajan) modları arasında geçiş yap. |
| `/heavy` | `/heavy <istemi>` | İcra | Yarışı atla; doğrudan en ağır/akıllı modele yönlendir. |
| `/fast` | `/fast <istemi>` | İcra | Yarışı atla; doğrudan hafif/hızlı modele yönlendir. |
| `/review` | `/review <dosya>` | İcra | Hedef dosyada derin güvenlik ve kod kalitesi denetimi yap. |
| `/agent` | `/agent [ad\|reset]` | Alt Ajan | `@architect`, `@coder` gibi alt ajanları incele veya sabitle. |
| `/model` | `/model [id\|reset]` | Sistem | Belirli bir NIM modeline kilitlen veya yarış havuzuna dön. |
| `/race` | `/race` | Sistem | Modellerin TTFT ve TPS hızlarını canlı kıyasla. |
| `/config` | `/config [refresh\|key]`| Sistem | API anahtarını güncelle veya model havuzlarını yenile. |
| `/approve` | `/approve [ask\|auto]` | Güvenlik | Diff onay politikasını değiştir. |
| `/undo` | `/undo [dosya\|all]` | Güvenlik | AI değişikliklerini geriye sar. |
| `/snapshots`| `/snapshots` | Güvenlik | Dosya anlık görüntülerinin listesini göster. |
| `/search` | `/search <desen>` | Bağlam | Çalışma alanında yüksek hızlı regex kod araması yap. |
| `/add` | `/add <dosya>` | Bağlam | Belirli bir dosyayı bağlam penceresine ekle. |
| `/drop` | `/drop <dosya>` | Bağlam | Dosyayı bağlam penceresinden çıkar. |
| `/save` | `/save [ad]` | Oturum | Aktif oturumu diske kaydet. |
| `/sessions` | `/sessions` | Oturum | Kayıtlı oturumları listele. |
| `/resume` | `/resume [id\|latest]` | Oturum | Geçmiş oturumu geri yükle. |
| `/theme` | `/theme [ad]` | Arayüz | Terminal temasını değiştir (`tokyo-night`, `matrix`, `dracula`...). |
| `/status` | `/status` | Arayüz | Oturum teşhis kartını ve durum çubuğunu göster. |
| `/tokens` | `/tokens` | Teşhis | Oturumda harcanan prompt ve çıktı token istatistiklerini göster. |
| `/diff` | `/diff` | Git | Commit'lenmemiş Git değişikliklerini ekranda göster. |
| `/commit` | `/commit` | Git | Otomatik konvansiyonel commit mesajı üretip commit'le. |
| `/branch` | `/branch [ad]` | Git | Git dalını göster veya yeni dala geçiş yap. |
| `/run` | `/run <komut>` | Sistem | Çalışma alanında doğrudan terminal komutu koştur. |
| `/clear` | `/clear` | Arayüz | Terminal ekranını temizle. |
| `/help` | `/help` | Yardım | Tüm komutların listesini yazdır. |
| `/exit` | `/exit` | Sistem | MachCode CLI'dan güvenle çıkış yap. |

---

## ❓ Sıkça Sorulan Sorular & Sorun Giderme

### 1. Neden her yarışta `poolside/laguna-xs` kazanıyordu?
`laguna-xs`, 50ms gibi çok kısa bir sürede ilk token'ı basan hafif bir mikro-modeldir. Eski handikap filtresi bu modeli geciktirmediği için Kimi K3.1 ve DeepSeek R1 gibi zeki modeller henüz düşünürken yarışı bitiriyordu. Son güncelleme ile:
- `laguna-xs` WeakPool havuzuna alındı.
- Hızlı modeller için 1.6 saniyelik adil handikap uygulanarak düşünce modellerine öncelik tanındı.

### 2. Kimi K3.1 modelini doğrudan nasıl kullanabilirim?
İki kolay yöntem vardır:
- Tek seferlik: `mach> /heavy [sorunuz]`
- Kalıcı sabitleme: `mach> /model moonshotai/kimi-k3.1`

### 3. API anahtarımı değiştirmek istersem ne yapmalıyım?
Terminal içerisindeyken şu komutu çalıştırmanız yeterlidir:
```bash
mach> /config key nvapi-yeni-anahtariniz
```

---

## 📄 Lisans
Bu proje **[MIT Lisansı](LICENSE)** altında sunulmaktadır.
Katkıda bulunmak için lütfen [CONTRIBUTING.md](CONTRIBUTING.md) belgesini inceleyin.
