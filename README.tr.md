# ⚡ MachCode Kullanım Kılavuzu

<p align="center">
  <strong>Terminaliniz İçin Ultra Hızlı, Çoklu Model Destekli Yapay Zeka Kodlama Asistanı</strong><br />
  <em>NVIDIA NIM altyapısıyla güçlendirildi. Yavaş API kuyruklarında beklememeniz için en iyi modelleri aynı anda yarıştırır. Çift modlu çalışma (Plan & Build), cerrahi kod düzenleme ve anında geri alma (undo) yetenekleri içerir.</em>
</p>

<p align="center">
  <a href="README.tr.md">🇹🇷 Türkçe Kullanım Kılavuzu</a> | <a href="README.md">🇬🇧 English Documentation</a>
</p>

<p align="center">
  <a href="https://github.com/gokaykrbs/MachCode/releases"><img src="https://img.shields.io/badge/version-v0.1.0-blue.svg?style=flat-square" alt="version" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green.svg?style=flat-square" alt="License: MIT" /></a>
  <a href="https://github.com/gokaykrbs/MachCode/actions"><img src="https://img.shields.io/badge/tests-110%2F110%20passing-brightgreen.svg?style=flat-square" alt="Tests Passing" /></a>
  <a href="https://build.nvidia.com"><img src="https://img.shields.io/badge/NVIDIA%20NIM-57%2B%20Models-76B900.svg?style=flat-square&logo=nvidia" alt="NVIDIA NIM" /></a>
  <a href="#"><img src="https://img.shields.io/badge/TypeScript-5.6-blue.svg?style=flat-square&logo=typescript" alt="TypeScript" /></a>
  <a href="#"><img src="https://img.shields.io/badge/CLI-Global%20Binary-cyan.svg?style=flat-square" alt="CLI" /></a>
</p>

---

## 📖 MachCode Nedir?

**MachCode**, geliştiriciler için hız, güvenlik ve hassasiyet odaklı tasarlanmış açık kaynaklı, terminal tabanlı bir yapay zeka kodlama asistanıdır.

Geleneksel araçlar gibi tek bir yapay zeka modeline takılıp kalmak yerine MachCode, **NVIDIA Build (NIM)** üzerinden onlarca lider üretken yapay zeka modeline (DeepSeek, Kimi, Llama 3.1, Qwen Coder, Mistral, Nemotron vb.) aynı anda istek gönderir. **İlk geçerli cevabı üreten model yarışı kazanır**, diğerleri anında iptal edilir. Böylece API kuyruklarında veya sunucu gecikmelerinde hiç beklemeden ışık hızında yanıt alırsınız.

```text
                     Kullanıcı İstemi / Görev
                                │
                                ▼
        [Mevcut Tüm Modeller Arasında Paralel Yarış]
      (DeepSeek, Kimi, Llama 3.1, Qwen Coder, Nemotron...)
                                │
        ┌───────────────────────┴───────────────────────┐
        │ İlk Model Gerçek Cevap Token'ını Üretir       │ Ağ / Timeout Durumu
        ▼                                               ▼
[Anında Kilitlenme & Akış]                    [Yedek Hızlı Model Havuzu]
• En hızlı cevap veren modele kilitlenir      • Anında yedek modeller devreye girer
• Kalan akışları iptal eder                   • Asla cevapsız veya askıda kalmazsınız
• Terminalinize temiz şekilde basar
```

---

## 🚀 60 Saniyede Hızlı Başlangıç

### 1. Kurulum
MachCode'u terminalinizden tek komutla kurun:

```bash
npm install -g machcode
```

*(Veya kaynak koddan kurmak isterseniz: `git clone https://github.com/gokaykrbs/MachCode.git && cd MachCode && pnpm install && pnpm run build && npm link`)*

### 2. Çalıştırma
Herhangi bir proje klasörünüzde terminale `mach` yazın:

```bash
mach
```

### 3. Ücretsiz API Anahtarınızı Tanımlayın
MachCode ilk açılışta sizden NVIDIA Build API anahtarınızı ister.
- **[build.nvidia.com](https://build.nvidia.com)** adresinden ücretsiz hesap açıp hemen bir API anahtarı (`nvapi-...`) alabilirsiniz.
- Dilerseniz çevre değişkeni olarak da tanımlayabilirsiniz:
  ```bash
  export NVIDIA_API_KEY="nvapi-anahtariniz"     # macOS / Linux
  $env:NVIDIA_API_KEY="nvapi-anahtariniz"        # Windows PowerShell
  ```

---

## 🧭 Temel Kavramlar: MachCode Nasıl Çalışır?

### 1. Çift Çalışma Modu: Plan & Build
Klavyenizden `Tab` tuşuna basarak veya `/mode` yazarak dilediğiniz an modlar arasında geçiş yapabilirsiniz:

| Mod | Ne Yapar? | Ne Zaman Kullanılır? |
| :--- | :--- | :--- |
| **`[PLAN]`** | **Salt Okunur / Güvenli:** Dosyalara dokunmaz, sistemde komut çalıştırmaz. Kod tabanını analiz eder ve plan çıkarır. | Yeni bir projeyi incelerken, mimari tasarlarken veya genel soru sorarken. |
| **`[BUILD]`** | **Aktif Ajan:** Dosyaları okur, cerrahi olarak düzenler, test koşturur ve izin dahilinde terminal komutu çalıştırır. | Kod yazarken, hata düzeltirken (bug fix) ve yeni özellik eklerken. |

---

### 2. İnsan Onaylı Güvenlik & Diff Önizleme
Kontrol her zaman sizdedir. MachCode bir dosyayı değiştirmeden veya yeni bir dosya oluşturmadan önce terminalde satır bazlı renkli bir diff kartı gösterir:

```text
══════════════════════════════════════════════════════════════════
  DOSYA DÜZENLEME TEKLİFİ: src/server.ts (+2 / -1 satır)
══════════════════════════════════════════════════════════════════
  @@ -15,3 +15,4 @@
  - const port = 3000;
  + const port = process.env.PORT || 8080;
  + console.log(`Sunucu ${port} portunda çalışıyor`);

[Y]es (uygula) / [n]o (reddet) / [a]ll (tümünü onayla) / [d]iff (tamamını gör) ?
```

- **Onayla (`y`)**: Değişikliği anında dosyaya uygular.
- **Reddet (`n`)**: Değişikliği iptal eder; yapay zekaya neyi düzeltmesi gerektiğini söyleyebilirsiniz.
- **Geri Al (`/undo`)**: Fikrinizi mi değiştirdiniz? `/undo` yazarak dosyayı anında eski haline döndürebilirsiniz.

---

### 3. Dosya Referansları (`@dosya`)
İstemlerinizde herhangi bir dosya veya klasöre `@` işaretiyle doğrudan atıfta bulunabilirsiniz:
```bash
mach> @src/auth/jwt.ts dosyasındaki kimlik doğrulama mantığı nasıl çalışıyor?
mach> @src/utils/math.ts dosyasını refactor et ve testlerini @tests/math.test.ts içine yaz
```
MachCode ilgili dosyayı otomatik olarak okur ve konuşma bağlamına dahil eder.

---

## 🎛️ Model Seçimi ve Yönetimi

MachCode varsayılan olarak en hızlı yanıt veren modeli otomatik seçer. Ancak dilediğiniz zaman modelleri yönlendirebilirsiniz:

### 1. Varsayılan Yarış Modu (Önerilen)
Sadece sorunuzu veya görevinizi normal şekilde yazın. MachCode modelleri paralel olarak yarıştırıp en hızlı cevabı getirir:
```bash
mach> TypeScript ile cancel destekli bir debounce fonksiyonu yaz
```

### 2. Derin Akıl Yürütme Modu (`/heavy`)
Karmaşık algoritmalar, zorlu refactor işlemleri veya derin mimari kararlar için yarışı atlayıp görevi doğrudan en güçlü akıl yürüten modele gönderin:
```bash
mach> /heavy Bu veritabanı şemasındaki olası race condition ve deadlock risklerini analiz et
```

### 3. Hızlı Cevap Modu (`/fast`)
Basit syntax soruları, pratik yardım veya bash komutları için en hızlı hafif modele yönlendirin:
```bash
mach> /fast Linux'ta 7 günden eski log dosyalarını silen bash komutunu yaz
```

### 4. Belirli Bir Modele Sabitleme (`/model`)
Tüm oturum boyunca sadece tek bir modelle çalışmak isterseniz:
```bash
# İstediğiniz modele sabitleyin:
mach> /model deepseek-ai/deepseek-r1
mach> /model qwen/qwen2.5-coder-32b-instruct

# Sabitlemeyi kaldırıp paralel yarışa dönün:
mach> /model reset

# NVIDIA hesabınızdaki en yeni modelleri anında senkronize edin:
mach> /model refresh
```

### 5. Canlı Hız Testi (`/race`)
Kendi internet bağlantınızda modellerin ilk token gecikmesini (TTFT) ve saniye başına üretim hızını (TPS) anlık test etmek için:
```bash
mach> /race
```

---

## 🤖 Uzman Alt Ajanlar (Subagents)

MachCode içinde farklı görevler için özelleştirilmiş 5 uzman yapay zeka ajanı bulunur. İsteminizin başına `@<ajan>` yazarak doğrudan çağırabilir veya `/agent <ad>` ile oturumunuza sabitleyebilirsiniz:

| Alt Ajan | Etiket | Mod | En İyi Olduğu Konular |
| :--- | :--- | :---: | :--- |
| **Architect** | `@architect` | `PLAN` | Sistem mimarisi, veritabanı şemaları, API tasarımları ve proje yapısı. |
| **Coder** | `@coder` | `BUILD` | Temiz kod yazımı, hata düzeltme ve yeni özellik geliştirme. |
| **Tester** | `@tester` | `BUILD` | Birim (unit) testleri, mock hazırlama ve uç durumları (edge-case) test etme. |
| **Reviewer** | `@reviewer` | `PLAN` | Kod inceleme, güvenlik açığı tespiti ve performans optimizasyonu. |
| **NVIDIA Specialist** | `@nvidia` | `BUILD` | GPU hızlandırma, CUDA C++, TensorRT, cuDF ve yüksek başarımlı hesaplama. |

**Örnekler:**
```bash
mach> @architect Çok kiracılı (multi-tenant) bir SaaS için veritabanı tablolarını tasarla
mach> @coder Kayan pencere (sliding window) algoritmasıyla bir rate limiter middleware yaz
mach> @tester Auth servisimiz için kapsamlı node:test testlerini hazırla
mach> @reviewer src/api/payment.ts dosyasını güvenlik risklerine karşı denetle
```

---

## 💾 Oturumlar & Geri Alma (Undo)

Çalışmalarınız asla kaybolmaz. MachCode tüm ilerlemenizi otomatik olarak korur:

- **Anlık Kayıt:** İstediğiniz an `/save [ad]` yazarak oturumunuza bir isim verip kaydedebilirsiniz.
- **Oturumları Listele:** `/sessions` yazarak önceki tüm oturumlarınızı görebilirsiniz.
- **Kaldığınız Yerden Devam Edin:**
  ```bash
  # MachCode içerisindeyken:
  mach> /resume latest
  mach> /resume auth-gelistirme

  # Doğrudan terminalden başlatırken:
  mach --resume
  mach --resume auth-gelistirme
  ```
- **Dosya Değişikliklerini Geri Alma:**
  ```bash
  mach> /undo             # Yapılan en son değişikliği geri alır
  mach> /undo src/app.ts  # Belirli bir dosyadaki değişiklikleri geri alır
  mach> /undo all         # Oturumdaki tüm dosya değişikliklerini sıfırlar
  mach> /snapshots        # Değişiklik geçmişini listeler
  ```

---

## 📖 Pratik Komut Tablosu

Terminalde `/` yazarak otomatik açılan menüden seçim yapabilir veya şu komutları kullanabilirsiniz:

| Komut | Kullanım | Açıklama |
| :--- | :--- | :--- |
| `/mode` | `/mode [plan\|build]` | Plan (salt okunur) ve Build (aktif ajan) modları arasında geçiş yap (`Tab`). |
| `/ask` | `/ask <soru>` | Dosyalara dokunmadan salt sohbet/soru-cevap yap. |
| `/heavy` | `/heavy <istemi>` | Yarışı atla; doğrudan en güçlü akıl yürüten modele gönder. |
| `/fast` | `/fast <istemi>` | Yarışı atla; doğrudan en hızlı hafif modele gönder. |
| `/model` | `/model [id\|reset\|refresh]` | Modelleri listele, modele kilitlen veya NVIDIA Build API ile senkronize et. |
| `/race` | `/race` | Modellerin anlık yanıt hızlarını ve gecikmelerini test et (benchmark). |
| `/review` | `/review <dosya>` | Hedef dosyada otomatik güvenlik ve kod kalitesi denetimi yap. |
| `/agent` | `/agent [ad\|reset]` | Uzman alt ajanları incele veya oturuma sabitle. |
| `/undo` | `/undo [dosya\|all]` | Yapay zekanın yaptığı dosya değişikliklerini geri al. |
| `/snapshots`| `/snapshots` | Dosya değişiklik geçmişini listele. |
| `/approve` | `/approve [ask\|auto]` | Dosya yazma öncesindeki diff onay politikasını değiştir. |
| `/search` | `/search <desen>` | Tüm projede yüksek hızlı regex kod araması yap. |
| `/add` / `/drop` | `/add <dosya>` | Dosyayı kalıcı bağlam penceresine ekle veya çıkar. |
| `/save` | `/save [ad]` | Aktif oturumu diske kaydet. |
| `/sessions` | `/sessions` | Kayıtlı oturumları listele. |
| `/resume` | `/resume [id\|latest]` | Geçmiş oturumu geri yükle ve devam et. |
| `/theme` | `/theme [ad]` | Terminal temasını değiştir (`tokyo-night`, `matrix`, `dracula`...). |
| `/status` | `/status` | Durum çubuğunu ve oturum istatistiklerini göster. |
| `/tokens` | `/tokens` | Harcanan token miktarını görüntüle. |
| `/diff` | `/diff` | Commit'lenmemiş Git değişikliklerini ekranda göster. |
| `/commit` | `/commit` | Otomatik açıklayıcı commit mesajı oluşturup commit'le. |
| `/branch` | `/branch [ad]` | Git dalını göster veya yeni dala geç. |
| `/run` | `/run <komut>` | Çalışma alanında doğrudan terminal komutu koştur. |
| `/config` | `/config [key\|refresh]`| API anahtarını veya model havuzunu güncelle. |
| `/clear` | `/clear` | Terminal ekranını temizle. |
| `/help` | `/help` | Komut yardım kartını yazdır. |
| `/exit` | `/exit` | MachCode'dan güvenle çıkış yap. |

---

## ❓ Sıkça Sorulan Sorular (SSS)

### 1. MachCode nedir, diğer araçlardan farkı ne?
Çoğu yapay zeka aracı tek bir sağlayıcıya (örneğin sadece Claude veya sadece OpenAI) bağlıdır. O sunucuda yoğunluk veya bekleme olduğunda siz de beklersiniz.

MachCode, bünyesinde onlarca farklı sağlayıcının en iyi modellerini barındıran **NVIDIA Build (NIM)** altyapısını kullanır. Sorunuzu aynı anda birden fazla modele gönderir ve ilk kim cevap verirse onu ekrana basar. Böylece hem sıfır bekleme süresi hem de kesintisiz çalışma elde edersiniz.

### 2. Yarış yerine sadece belirli bir modeli kullanabilir miyim?
Evet! İstediğiniz zaman dilediğiniz modeli seçebilirsiniz:
```bash
mach> /model deepseek-ai/deepseek-r1
```
Tekrar yarış moduna dönmek için tek yapmanız gereken `/model reset` yazmaktır.

### 3. Kodlarım güvende mi? MachCode benden habersiz dosya değiştirir mi?
Varsayılan olarak **MachCode izniniz olmadan asla bir dosyayı değiştiremez**. Her düzenleme öncesinde satır satır neyin eklendiğini/silindiğini gösteren renkli bir diff kartı açar ve onayınızı (`[Y]es / [n]o`) bekler. Beğenmediğiniz bir değişikliği `/undo` ile saniyeler içinde geri alabilirsiniz.

### 4. API anahtarını nasıl alırım?
**[build.nvidia.com](https://build.nvidia.com)** adresine gidin, ücretsiz bir hesap açın ve bir API anahtarı (`nvapi-...`) oluşturun. NVIDIA geliştiricilere ücretsiz deneme kredisi sunmaktadır. Anahtarı aldıktan sonra terminalde `mach` yazıp yapıştırmanız yeterlidir.

### 5. NVIDIA yeni bir model eklediğinde ne olur?
MachCode, NVIDIA Build API ile dinamik olarak senkronizedir. Yeni modeller yayınlandığında sistem arka planda bunları otomatik keşfeder. Dilediğiniz zaman tek bir komutla da modelleri tazeleyebilirsiniz:
```bash
mach> /model refresh
```

### 6. MachCode'u sadece soru sormak veya kod incelemek için kullanabilir miyim?
Evet. `Tab` tuşuna basarak veya `/mode plan` yazarak **Plan Modu**'na geçebilirsiniz. Bu modda MachCode salt okunur çalışır; dosyalarınızı inceler ve sorularınızı cevaplar ancak asla kodlarda değişiklik yapmaz.

---

## 📄 Lisans

MachCode, **[MIT Lisansı](LICENSE)** altında sunulan ücretsiz ve açık kaynaklı bir yazılımdır.
Katkıda bulunmak ve topluluk kuralları için [CONTRIBUTING.md](CONTRIBUTING.md) dosyasını inceleyebilirsiniz.
