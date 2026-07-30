# 🚀 GitHub-қа жүктеу және интернетке шығару

Жоба толық дайын, git commit жасалған, remote қосылған.
Қалғаны — екі қадам: **GitHub-қа жүктеу** және **хостингке шығару**.

---

## 1-қадам · GitHub-қа жүктеу (push)

### A нұсқа · Компьютеріңізден (ең қарапайым)

Жобаның ZIP архивін жүктеп алып, компьютеріңізде мына командаларды орындаңыз:

```bash
cd kz-history-rpg

git remote add origin https://github.com/zhalgasbaevaaaa-create/akylbekbedelkhan.git
git branch -M main
git push -u origin main
```

GitHub логин мен пароль сұрайды. **Пароль орнына Personal Access Token
керек** (GitHub 2021 жылдан бері кәдімгі парольді қабылдамайды):

1. GitHub → оң жақ жоғарыдағы аватар → **Settings**
2. Ең төменде → **Developer settings**
3. **Personal access tokens → Tokens (classic)** → **Generate new token (classic)**
4. Note: `akylbekbedelkhan`, Expiration: `90 days`
5. ☑ **repo** құсбелгісін қойыңыз (басқасының қажеті жоқ)
6. **Generate token** → шыққан `ghp_...` жолын көшіріп алыңыз

Push кезінде:
```
Username: zhalgasbaevaaaa-create
Password: ghp_осында_токеніңізді_қойыңыз
```

### B нұсқа · GitHub Desktop (команда жазбай)

1. [desktop.github.com](https://desktop.github.com) — бағдарламаны орнатыңыз
2. **File → Add local repository** → `kz-history-rpg` папкасын таңдаңыз
3. **Publish repository** → репозиторий атауын `akylbekbedelkhan` деп қойыңыз
4. **Publish**

### C нұсқа · Браузер арқылы (ең оңай, бірақ қолмен)

1. https://github.com/zhalgasbaevaaaa-create/akylbekbedelkhan бетін ашыңыз
2. **uploading an existing file** сілтемесін басыңыз
3. `kz-history-rpg` папкасының **ішіндегі барлық файлды** сүйреп тастаңыз
   (⚠️ `node_modules` және `dist` папкаларын **қоспаңыз**)
4. **Commit changes**

---

## 2-қадам · Интернетке шығару

### Render.com — тегін, ең оңай (ұсынылады)

1. [render.com](https://render.com) → **Get Started** → GitHub арқылы кіріңіз
2. **New +** → **Blueprint**
3. `akylbekbedelkhan` репозиторийін таңдаңыз
4. Render `render.yaml` файлын өзі табады — ол **екі сервис** жасайды:
   - `kz-history-db` — тегін PostgreSQL дерекқоры
   - `kz-history-rpg` — веб-сайт
5. `ADMIN_PASSWORD` өрісіне өз пароліңізді жазыңыз
6. **Apply** → 3–5 минут күтіңіз

> **Неге PostgreSQL, SQLite емес?**
> Render-дің тегін жоспарында тұрақты диск (persistent disk) берілмейді —
> «disks are not supported for free tier services» деген қате осыдан шығады.
> Дискісіз SQLite файлы әр рестартта жоғалар еді. Сондықтан деректер бөлек
> тегін PostgreSQL сервисінде сақталады: сайт қайта қосылса да, студенттердің
> нәтижелері орнында қалады. Кодта ешнәрсе өзгертудің қажеті жоқ —
> дерекқор адаптері екеуін де қолдайды.

Дайын! Сайт мекенжайы:
```
https://kz-history-rpg.onrender.com
```

| Бет | Мекенжай |
|---|---|
| 🎮 Ойын | `https://kz-history-rpg.onrender.com` |
| 🔐 Админ | `https://kz-history-rpg.onrender.com/admin` |

> **Ескерту:** тегін жоспарда сайт 15 минут бос тұрса «ұйықтайды».
> Студент кірген кезде ~30 секунд оянады. Сабақ алдында бір рет ашып
> қойсаңыз, бүкіл сабақ бойы жылдам жұмыс істейді.

### Fly.io — ұйықтамайды, бірақ карта тіркеу керек

```bash
fly launch --no-deploy
fly volumes create game_data --size 1 --region fra
fly secrets set JWT_SECRET="$(openssl rand -hex 32)" ADMIN_PASSWORD="паролыңыз"
fly deploy
```

### Railway

1. [railway.app](https://railway.app) → **New Project → Deploy from GitHub repo**
2. **+ New → Database → PostgreSQL** қосыңыз (сол жобаның ішінде)
3. Веб-сервистің **Variables** бөліміне:
   ```
   DB_DRIVER      = postgres
   DATABASE_URL   = ${{Postgres.DATABASE_URL}}
   JWT_SECRET     = ұзын-кездейсоқ-жол
   ADMIN_PASSWORD = өз-паролыңыз
   ```

> Railway-де де диск орнына PostgreSQL қолданылады — солай сенімдірек.

---

## 3-қадам · Деплойдан кейін

### ✅ Тексеру тізімі

- [ ] Сайт ашылды ма? → `https://.../`
- [ ] «7 бөлме · 124 тапсырма дайын» деген жазу шықты ма?
- [ ] Админ панеліне кіре аласыз ба? → `/admin`
- [ ] **Парольді өзгерттіңіз бе?** → ⚙ Баптау → Парольді өзгерту
- [ ] Тест ойын ойнап көрдіңіз бе?
- [ ] Excel экспорты жүктеле ме?

### ⚠️ Ең маңызды қадам

Деплойдан кейін **бірден** админ парольді өзгертіңіз:

```
/admin → Akilbek8080 паролімен кіру → ⚙ Баптау → Парольді өзгерту
```

Әдепкі пароль ашық репозиторийде жазылған, сондықтан оны қалдыруға болмайды.

### 📄 Тапсырмаларды жаңарту

Жаңа PDF дайындағанда кодқа тиіспейсіз:

```
/admin → ⚙ Баптау → PDF тапсырмалар → файлды сүйреп тастау
```

Тапсырмалар сол сәтте автоматты жаңарады.

### 👨‍🎓 Студенттерге не айту керек

> Сілтеме: `https://kz-history-rpg.onrender.com`
> Аты, тегі, тобы мен оқу орныңды дұрыс жаз — нәтиже соған жазылады.
> Ойынға **3 рет** қана кіре аласың. Әр бөлмеде 5 жаның бар.

---

## 🆘 Мәселе шықса

| Мәселе | Шешім |
|---|---|
| Push кезінде `Authentication failed` | Пароль емес, **Personal Access Token** керек (жоғарыдан қараңыз) |
| `remote origin already exists` | `git remote set-url origin https://github.com/...` |
| Render-де build құлады | Logs бөлімін ашып, `npm ci` қатесін қараңыз. Node 20 екеніне көз жеткізіңіз |
| Сайтта «Тапсырмалар жүктелмеген» | `/admin` → ⚙ Баптау → PDF жүктеңіз |
| Студент нәтижесі жоғалды | Volume қосылмаған. Render → Disks бөлімін тексеріңіз |
| Сайт баяу ашылады | Тегін жоспардың «ұйықтауы». Сабақ алдында бір рет ашып қойыңыз |
| `disks are not supported for free tier services` | Ескі `render.yaml` дискіні сұраған. Қазіргі нұсқада диск жоқ — репозиторийді жаңартып, Blueprint-ті қайта жасаңыз |
| `DATABASE_URL is not defined` | PostgreSQL сервисі құрылмаған. Render → Blueprint қайта іске қосыңыз немесе қолмен PostgreSQL қосып, `DATABASE_URL` айнымалысын байланыстырыңыз |

---

## 💾 Деректер қайда сақталады?

| Не | Қайда | Рестарттан кейін |
|---|---|---|
| Студенттер, нәтижелер, Best Score | PostgreSQL (бөлек сервис) | ✅ сақталады |
| Админ паролі (bcrypt hash) | PostgreSQL | ✅ сақталады |
| PDF тапсырмалар | Репозиторийдегі `server/uploads/tasks.pdf` | ✅ автоматты қалпына келеді |
| Админ панелі арқылы жүктелген PDF | Уақытша файлдық жүйе | ⚠️ рестартта бастапқы нұсқаға оралады |

**Тапсырмаларды тұрақты өзгерту:** жаңа PDF-ті GitHub-тағы
`server/uploads/tasks.pdf` файлының орнына жүктеңіз — Render автоматты
қайта деплой жасайды. Ал админ панелі арқылы жүктеу — сабақ барысында
жылдам тексеріп көруге ыңғайлы (рестартқа дейін жұмыс істейді).
