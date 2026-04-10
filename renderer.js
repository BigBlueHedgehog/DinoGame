/**
 * renderer.js — Логика игры Dino Runner
 *
 * Содержит:
 * - Игровой цикл (requestAnimationFrame)
 * - Управление игроком (прыжок, гравитация)
 * - Генерация и движение препятствий
 * - Проверка столкновений
 * - Система очков и рекордов
 * - Частицы, эффекты, смена дня/ночи
 */

// ========================
// Music Manager — фоновая музыка из файлов
// Использует HTML5 Audio с зацикливанием (loop)
// ========================

const musicManager = {
  tracks: [
    { name: 'Purple Dream', src: 'songs/Ghostrifter-Official-Purple-Dream(chosic.com).mp3' },
    { name: 'Transcendence', src: 'songs/Transcendence-chosic.com_.mp3' },
    { name: 'Champagne Coast', src: 'songs/Lewis_Hanton_-_Champagne_Coast_-_Instrumental_79401556.mp3' },
  ],
  currentTrack: parseInt(localStorage.getItem('musicTrack')) || 0,
  isMuted: localStorage.getItem('musicMuted') === 'true',
  audio: null,       // HTMLAudioElement для фоновой музыки
  isPlaying: false,

  /** Инициализация (при первом действии пользователя) */
  init() {
    if (this.audio) return; // Уже инициализирован

    this.audio = new Audio();
    this.audio.loop = true;  // Бесконечное зацикливание
    this.audio.volume = this.isMuted ? 0 : 0.3;
    this.audio.muted = this.isMuted;
    this._loadTrack();

    this.updateMuteButton();
  },

  /** Загрузить текущий трек */
  _loadTrack() {
    if (!this.audio) return;
    this.audio.src = this.tracks[this.currentTrack].src;
  },

  /** Запуск фоновой музыки */
  playBackground() {
    if (!this.audio) return;
    if (this.isPlaying) return;

    this._loadTrack();
    this.audio.currentTime = 0;
    this.audio.preload = 'auto';
    const playPromise = this.audio.play();
    if (playPromise !== undefined) {
      playPromise.catch((err) => {
        console.warn('Music play failed:', err);
      });
    }
    this.isPlaying = true;
  },

  /** Остановка фоновой музыки */
  stopBackground() {
    if (!this.audio) return;
    if (!this.isPlaying) return;
    this.isPlaying = false;
    this.audio.pause();
    this.audio.currentTime = 0;
  },

  /** Переключение mute/unmute */
  toggleMute() {
    this.isMuted = !this.isMuted;
    localStorage.setItem('musicMuted', this.isMuted);

    if (this.audio) {
      this.audio.muted = this.isMuted;
    }
    this.updateMuteButton();
  },

  /** Переключение на следующий трек */
  nextTrack() {
    this.currentTrack = (this.currentTrack + 1) % this.tracks.length;
    localStorage.setItem('musicTrack', this.currentTrack);

    // Если сейчас играет фоновая музыка — перезапускаем с новым треком
    if (this.isPlaying && this.audio) {
      this._loadTrack();
      this.audio.play().catch(() => {});
    }
  },

  /** Обновить кнопку mute — меняем иконку */
  updateMuteButton() {
    const icon = document.getElementById('music-toggle-icon');
    if (icon) {
      icon.src = this.isMuted ? 'assets/icon-music-off.png' : 'assets/icon-music-on.png';
    }
  },

  /** Звук столкновения — мягкий приглушённый тон */
  playCrash() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const now = ctx.currentTime;

      // Мягкий низкочастотный тон (sine, не sawtooth)
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(200, now);
      osc.frequency.exponentialRampToValueAtTime(80, now + 0.4);

      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.4);
    } catch (e) {}

    // Останавливаем всю музыку при столкновении
    this.stopBackground();
  },
};

// ========================
// Получаем элементы DOM
// ========================

const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const gameContainer = document.getElementById('game-container');
const scoreElement = document.getElementById('score');
const highscoreElement = document.getElementById('highscore');
const startScreen = document.getElementById('start-screen');
const gameoverScreen = document.getElementById('gameover-screen');
const skinSelectScreen = document.getElementById('skinselect-screen');
const finalScoreElement = document.getElementById('final-score');
const skinPreviewCanvas = document.getElementById('skin-preview-canvas');
const skinPreviewCtx = skinPreviewCanvas.getContext('2d');

// Устанавливаем внутреннее разрешение canvas
canvas.width = 1200;
canvas.height = 600;

// ========================
// Константы и настройки игры
// ========================

const GROUND_Y = 480;          // Y-координата земли
const GRAVITY = 0.65;          // Сила гравитации
const JUMP_FORCE = -13;        // Сила прыжка
const INITIAL_SPEED = 6;       // Начальная скорость препятствий
const SPEED_INCREMENT = 0.003; // Прирост скорости за кадр
const MAX_SPEED = 16;          // Максимальная скорость (сложный, но проходимый потолок)
const OBSTACLE_MIN_GAP = 90;   // Минимальное расстояние между препятствиями (в кадрах)

// ========================
// Состояние игры
// ========================

let gameState = 'start'; // 'start' | 'playing' | 'gameover' | 'skinSelect'
let score = 0;
let highScore = parseInt(localStorage.getItem('dinoHighScore')) || 0;
let gameSpeed = INITIAL_SPEED;
let frameCount = 0;        // Счётчик кадров для генерации препятствий
let isNight = false;
let lastObstacleY = 0;     // Для отслеживания последнего препятствия
let selectedSkin = parseInt(localStorage.getItem('selectedSkin')) || 0; // Выбранный скин
let currentSkin = selectedSkin; // Текущий отображаемый скин в меню
let debugHitbox = false;   // Отладка хитбоксов (F1)

// ========================
// Игрок (гусь — спрайт из sprites/)
// ========================

// Массив скинов: путь, оригинальные размеры, хитбокс (в процентах)
// Формат hitbox: { x: % слева, y: % сверху, w: % ширины, h: % высоты }
// Если hitbox не указан — используется значение по умолчанию { x: 0.2, y: 0.05, w: 0.7, h: 0.9 }
const SKIN_SKINS = [
  { path: 'sprites/duck.png',                     w: 151, h: 202, hitbox: { x: 0.15, y: 0.02, w: 0.75, h: 0.95 } },
  { path: 'sprites/duck1.png',                    w: 285, h: 285, hitbox: { x: 0.20, y: 0.05, w: 0.70, h: 0.90 } },
  { path: 'sprites/image-no-background (2).png',  w: 281, h: 281, hitbox: { x: 0.20, y: 0.05, w: 0.70, h: 0.90 } },
  { path: 'sprites/image-no-background.png',      w: 506, h: 653, hitbox: { x: 0.15, y: 0.02, w: 0.75, h: 0.95 } },
  { path: 'sprites/no-background(2).png',         w: 418, h: 418, hitbox: { x: 0.20, y: 0.05, w: 0.70, h: 0.90 } },
  { path: 'sprites/no-background(3).png',         w: 212, h: 212, hitbox: { x: 0.20, y: 0.05, w: 0.70, h: 0.90 } },
];

// Хитбокс по умолчанию (если не указан у скина)
const DEFAULT_HITBOX = { x: 0.20, y: 0.05, w: 0.70, h: 0.90 };

// Целевая высота отрисовки в игре
const TARGET_DRAW_H = 100;

// Целевая высота отрисовки в окне выбора скина (превью)
const TARGET_PREVIEW_H = 120;

// Индивидуальный масштаб для каждого скина
const skinScales = SKIN_SKINS.map(s => TARGET_DRAW_H / s.h);
const skinDrawWidths = SKIN_SKINS.map((s, i) => s.w * skinScales[i]);
const skinDrawHeights = SKIN_SKINS.map(() => TARGET_DRAW_H);

// Вычисляем хитбоксы в пикселях
const skinHitboxes = SKIN_SKINS.map((s) => {
  const hb = s.hitbox || DEFAULT_HITBOX;
  const dw = skinDrawWidths[SKIN_SKINS.indexOf(s)];
  const dh = skinDrawHeights[SKIN_SKINS.indexOf(s)];
  return {
    x: Math.round(dw * hb.x),
    y: Math.round(dh * hb.y),
    w: Math.round(dw * hb.w),
    h: Math.round(dh * hb.h),
  };
});

// Базовый размер утки (для совместимости)
const DUCK_W = 151;
const DUCK_H = 202;
const DUCK_SCALE = 0.42;
const DUCK_DRAW_W = DUCK_W * DUCK_SCALE;
const DUCK_DRAW_H = DUCK_H * DUCK_SCALE;

// Загружаем все спрайты
const skinSprites = SKIN_SKINS.map(s => {
  const img = new Image();
  img.src = s.path;
  return img;
});

/** Получить спрайт текущего скина */
function getCurrentSkinSprite() {
  return skinSprites[selectedSkin];
}

/** Получить ширину отрисовки текущего скина */
function getCurrentSkinDrawW() {
  return skinDrawWidths[selectedSkin];
}

/** Получить высоту отрисовки текущего скина */
function getCurrentSkinDrawH() {
  return skinDrawHeights[selectedSkin];
}

/** Получить хитбокс текущего скина */
function getCurrentSkinHitbox() {
  return skinHitboxes[selectedSkin];
}

/** Получить хитбокс скина по индексу */
function getSkinHitbox(index) {
  return skinHitboxes[index];
}

/** Получить ширину отрисовки скина по индексу */
function getSkinDrawW(index) {
  return skinDrawWidths[index];
}

/** Получить высоту отрисовки скина по индексу */
function getSkinDrawH(index) {
  return skinDrawHeights[index];
}

const player = {
  x: 80,                    // Позиция X верха спрайта (фиксирована)
  // y будет установлен в reset() — позиция верха спрайта
  y: GROUND_Y - TARGET_DRAW_H,
  width: 66,                // Ширина хитбокса
  height: TARGET_DRAW_H,    // Высота хитбокса
  velocityY: 0,
  isJumping: false,
  color: '#F5DEB3',         // Бежевый (для частиц)

  /** Получить высоту текущего скина */
  getDrawHeight() {
    return getCurrentSkinDrawH();
  },

  /** Получить ширину текущего скина */
  getDrawWidth() {
    return getCurrentSkinDrawW();
  },

  /** Сброс состояния игрока */
  reset() {
    const drawH = this.getDrawHeight();
    const hb = getCurrentSkinHitbox();
    // y — позиция ВЕРХНЕГО КРАЯ спрайта (не хитбокса)
    this.y = GROUND_Y - drawH;
    this.velocityY = 0;
    this.isJumping = false;
    // Хитбокс рассчитывается отдельно
    this.width = hb.w;
    this.height = hb.h;
  },

  /** Прыжок */
  jump() {
    if (!this.isJumping) {
      this.velocityY = JUMP_FORCE;
      this.isJumping = true;
      spawnJumpParticles();
    }
  },

  /** Обновление физики игрока */
  update() {
    this.velocityY += GRAVITY;
    this.y += this.velocityY;
    const drawH = this.getDrawHeight();
    const groundY = GROUND_Y - drawH;
    if (this.y >= groundY) {
      this.y = groundY;
      this.velocityY = 0;
      this.isJumping = false;
    }
  },

  /** Отрисовка спрайта персонажа */
  draw() {
    const isJump = this.isJumping;
    const drawW = this.getDrawWidth();
    const drawH = this.getDrawHeight();

    // Подпрыгивание при беге
    const bounce = isJump ? 0 : Math.sin(frameCount * 0.2) * 3;

    // Лёгкое покачивание
    const wobble = isJump ? 0 : Math.sin(frameCount * 0.15) * 2;

    ctx.save();

    // Тень/свечение
    ctx.shadowColor = '#F5DEB3';
    ctx.shadowBlur = 8;

    // Позиция отрисовки
    const drawX = this.x + 2 + wobble;
    const drawY = this.y + bounce;

    // Рисуем спрайт
    const sprite = getCurrentSkinSprite();
    if (sprite && sprite.complete && sprite.naturalWidth > 0) {
      ctx.drawImage(sprite, drawX, drawY, drawW, drawH);
    } else {
      // Фоллбэк: если спрайт ещё не загрузился — рисуем бежевый прямоугольник
      ctx.fillStyle = '#F5DEB3';
      ctx.fillRect(drawX, drawY, drawW, drawH);
    }

    ctx.shadowBlur = 0;
    ctx.restore();
  },

  /** Получить границы столкновения (на основе хитбокса текущего скина) */
  getBounds() {
    const hb = getCurrentSkinHitbox();
    return {
      x: this.x + hb.x,
      y: this.y + hb.y,
      width: hb.w,
      height: hb.h,
    };
  },
};

// ========================
// Препятствия
// ========================

let obstacles = [];

/**
 * Класс препятствия
 */
class Obstacle {
  constructor() {
    this.width = 20 + Math.random() * 25;      // Случайная ширина (20–45)
    this.height = 30 + Math.random() * 45;     // Случайная высота (30–75)
    this.x = canvas.width;                      // Появляется справа
    this.y = GROUND_Y - this.height;            // Стоит на земле
    this.color = isNight ? '#e74c3c' : '#2c3e50';
    this.passed = false; // Флаг: пройден ли игроком
  }

  /** Обновление позиции */
  update() {
    this.x -= gameSpeed;
  }

  /** Отрисовка */
  draw() {
    ctx.fillStyle = this.color;
    ctx.fillRect(this.x, this.y, this.width, this.height);

    // Деталь — полоска сверху
    ctx.fillStyle = isNight ? '#c0392b' : '#34495e';
    ctx.fillRect(this.x + 3, this.y + 3, this.width - 6, 4);
  }

  /** Границы столкновения */
  getBounds() {
    return {
      x: this.x,
      y: this.y,
      width: this.width,
      height: this.height,
    };
  }

  /** Проверка: вышел ли за экран */
  isOffScreen() {
    return this.x + this.width < 0;
  }
}

/**
 * Создаёт новое препятствие с рандомным интервалом
 */
function spawnObstacle() {
  // Минимальный интервал между препятствиями (зависит от скорости)
  const minFrames = Math.max(40, OBSTACLE_MIN_GAP - gameSpeed * 3);
  const randomExtra = Math.random() * 60;

  if (frameCount - lastObstacleY > minFrames + randomExtra) {
    obstacles.push(new Obstacle());
    lastObstacleY = frameCount;
  }
}

// ========================
// Частицы
// ========================

let particles = [];

/**
 * Класс частицы
 */
class Particle {
  constructor(x, y, color) {
    this.x = x;
    this.y = y;
    this.size = 3 + Math.random() * 5;
    // Снос влево из-за бега игрока (от -5 до -1)
    this.speedX = -3.5 + Math.random() * 4;
    this.speedY = -3 + Math.random() * 2;
    this.color = color;
    this.life = 1.0; // Прозрачность (жизнь)
    this.decay = 0.02 + Math.random() * 0.03; // Скорость затухания
  }

  update() {
    this.x += this.speedX;
    this.y += this.speedY;
    this.life -= this.decay;
  }

  draw() {
    ctx.globalAlpha = this.life;
    ctx.fillStyle = this.color;
    ctx.fillRect(this.x, this.y, this.size, this.size);
    ctx.globalAlpha = 1.0;
  }

  isDead() {
    return this.life <= 0;
  }
}

/** Частицы при прыжке */
function spawnJumpParticles() {
  for (let i = 0; i < 8; i++) {
    particles.push(new Particle(
      player.x + player.getDrawWidth() / 2,
      GROUND_Y,
      '#F5DEB3'
    ));
  }
}

/** Частицы при столкновении */
function spawnCollisionParticles() {
  for (let i = 0; i < 20; i++) {
    particles.push(new Particle(
      player.x + player.getDrawWidth() / 2,
      player.y + player.getDrawHeight() / 2,
      '#e74c3c'
    ));
  }
}

/** Частицы "бег" (пыль из-под ног) */
function spawnRunParticles() {
  if (!player.isJumping && frameCount % 5 === 0) {
    particles.push(new Particle(
      player.x,
      GROUND_Y,
      isNight ? '#555' : '#bbb'
    ));
  }
}

// ========================
// Земля и фон
// ========================

let groundOffset = 0;

/**
 * Отрисовка земли с движущейся текстурой
 */
function drawGround() {
  const groundColor = isNight ? '#2c3e50' : '#95a5a6';
  const lineColor = isNight ? '#34495e' : '#bdc3c7';

  // Основная линия земли
  ctx.strokeStyle = groundColor;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, GROUND_Y);
  ctx.lineTo(canvas.width, GROUND_Y);
  ctx.stroke();

  // Движущиеся точки на земле (имитация текстуры)
  ctx.fillStyle = lineColor;
  groundOffset = (groundOffset + gameSpeed) % 40;

  for (let x = -groundOffset; x < canvas.width; x += 40) {
    ctx.fillRect(x, GROUND_Y + 8, 15, 2);
    ctx.fillRect(x + 20, GROUND_Y + 16, 8, 2);
  }
}

/**
 * Отрисовка земли без движения (при Game Over)
 */
function drawStaticGround() {
  const groundColor = isNight ? '#2c3e50' : '#95a5a6';
  const lineColor = isNight ? '#34495e' : '#bdc3c7';

  // Основная линия земли
  ctx.strokeStyle = groundColor;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, GROUND_Y);
  ctx.lineTo(canvas.width, GROUND_Y);
  ctx.stroke();

  // Статичные точки (без смещения)
  ctx.fillStyle = lineColor;
  for (let x = -(groundOffset % 40); x < canvas.width; x += 40) {
    ctx.fillRect(x, GROUND_Y + 8, 15, 2);
    ctx.fillRect(x + 20, GROUND_Y + 16, 8, 2);
  }
}

/**
 * Отрисовка звёзд (только ночью)
 */
function drawStars() {
  if (!isNight) return;

  ctx.fillStyle = '#fff';
  // Используем псевдослучайные позиции на основе кадра
  const starPositions = [
    [120, 50], [340, 80], [560, 40], [680, 90],
    [200, 110], [450, 60], [730, 70], [90, 130],
    [500, 120], [620, 30], [280, 95], [410, 45],
    [800, 55], [950, 85], [1100, 40], [870, 100],
    [1050, 70], [760, 120], [1150, 95], [350, 35],
  ];

  starPositions.forEach(([x, y], i) => {
    const twinkle = Math.sin(frameCount * 0.05 + i) * 0.5 + 0.5;
    ctx.globalAlpha = twinkle * 0.8 + 0.2;
    ctx.fillRect(x, y, 2, 2);
  });
  ctx.globalAlpha = 1.0;
}

// ========================
// Проверка столкновений
// ========================

/**
 * AABB (Axis-Aligned Bounding Box) проверка столкновений
 */
function checkCollision(boundsA, boundsB) {
  return (
    boundsA.x < boundsB.x + boundsB.width &&
    boundsA.x + boundsA.width > boundsB.x &&
    boundsA.y < boundsB.y + boundsB.height &&
    boundsA.y + boundsA.height > boundsB.y
  );
}

// ========================
// Смена дня и ночи (кнопка)
// ========================

/**
 * Переключение дня/ночи по кнопке
 */
function toggleDayNight() {
  isNight = !isNight;

  // Обновляем CSS-классы
  gameContainer.classList.toggle('night', isNight);
  gameContainer.classList.toggle('day', !isNight);
  updateDayNightBtn();
}

/**
 * Обновить иконку на кнопке день/ночь
 */
function updateDayNightBtn() {
  dayNightBtn.textContent = isNight ? '☀️' : '🌙';
}

// ========================
// Система очков
// ========================

function updateScore() {
  // Увеличиваем счёт каждые 6 кадров (~10 раз в секунду)
  if (frameCount % 6 === 0) {
    score++;
    scoreElement.textContent = String(score).padStart(4, '0');

    // Обновляем скорость
    gameSpeed = Math.min(MAX_SPEED, INITIAL_SPEED + score * SPEED_INCREMENT);
  }
}

function saveHighScore() {
  if (score > highScore) {
    highScore = score;
    localStorage.setItem('dinoHighScore', highScore);
  }
  highscoreElement.textContent = `BEST ${String(highScore).padStart(4, '0')}`;
}

// ========================
// Экран Game Over
// ========================

function showGameOver() {
  gameState = 'gameover';
  saveHighScore();
  finalScoreElement.textContent = score;
  gameoverScreen.classList.remove('hidden');

  // Тряска экрана
  gameContainer.classList.add('shake');
  setTimeout(() => gameContainer.classList.remove('shake'), 400);

  // Частицы столкновения
  spawnCollisionParticles();

  // Звук столкновения (музыка остановится внутри playCrash)
  musicManager.playCrash();
}

/** Отрисовка превью скина на canvas с анимацией */
function drawSkinPreview() {
  skinPreviewCtx.clearRect(0, 0, skinPreviewCanvas.width, skinPreviewCanvas.height);

  const sprite = skinSprites[currentSkin];
  if (sprite && sprite.complete && sprite.naturalWidth > 0) {
    const targetDrawH = TARGET_PREVIEW_H;
    const scale = targetDrawH / SKIN_SKINS[currentSkin].h;
    const w = SKIN_SKINS[currentSkin].w * scale;
    const h = targetDrawH;

    // Анимация подпрыгивания
    const bounce = Math.sin(frameCount * 0.08) * 6;
    // Покачивание
    const wobble = Math.sin(frameCount * 0.06) * 1.5;

    const baseY = skinPreviewCanvas.height / 2 - h / 2 + bounce;
    const drawY = baseY;
    const drawX = (skinPreviewCanvas.width - w) / 2 + wobble;

    // Подсветка (свечение)
    skinPreviewCtx.save();
    skinPreviewCtx.shadowColor = '#F5DEB3';
    skinPreviewCtx.shadowBlur = 15 + Math.sin(frameCount * 0.1) * 5;

    skinPreviewCtx.drawImage(sprite, drawX, drawY, w, h);

    skinPreviewCtx.shadowBlur = 0;
    skinPreviewCtx.restore();
  }
}

/** Показать экран выбора скина */
function showSkinSelect() {
  gameState = 'skinSelect';
  currentSkin = selectedSkin; // Начинаем с текущего выбранного
  skinSelectScreen.classList.remove('hidden');
  startScreen.classList.add('hidden');
  gameoverScreen.classList.add('hidden');
  drawSkinPreview();
}

/** Скрыть экран выбора скина */
function hideSkinSelect() {
  skinSelectScreen.classList.add('hidden');
}

/** Сменить скин вперёд */
function nextSkin() {
  currentSkin = (currentSkin + 1) % SKIN_SKINS.length;
  drawSkinPreview();
}

/** Сменить скин назад */
function prevSkin() {
  currentSkin = (currentSkin - 1 + SKIN_SKINS.length) % SKIN_SKINS.length;
  drawSkinPreview();
}

function resetGame() {
  // Сброс всех параметров
  score = 0;
  gameSpeed = INITIAL_SPEED;
  frameCount = 0;
  lastObstacleY = 0;
  obstacles = [];
  particles = [];
  player.reset();
  scoreElement.textContent = '0000';
  gameoverScreen.classList.add('hidden');
  hideSkinSelect();
  gameState = 'playing';

  // Перезапускаем фоновую музыку
  if (musicManager.audio) {
    musicManager.isPlaying = false;
  }
  musicManager.playBackground();
}

// ========================
// Главный игровой цикл
// ========================

function gameLoop() {
  // Очистка canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Рисуем фон (звёзды ночью)
  drawStars();

  if (gameState === 'playing') {
    frameCount++;

    // Обновляем игрока
    player.update();
    spawnRunParticles();

    // Генерируем препятствия
    spawnObstacle();

    // Обновляем препятствия
    obstacles.forEach(obs => obs.update());

    // Удаляем ушедшие за экран
    obstacles = obstacles.filter(obs => !obs.isOffScreen());

    // Проверка столкновений
    const playerBounds = player.getBounds();
    for (const obs of obstacles) {
      if (checkCollision(playerBounds, obs.getBounds())) {
        showGameOver();
        break;
      }
    }

    // Обновляем счёт
    updateScore();
  } else if (gameState === 'skinSelect') {
    frameCount++;
    drawSkinPreview();
    // Не обновляем частицы и препятствия при выборе скина
    particles = [];
    obstacles = [];
  }

  // Обновляем и рисуем частицы (только в игре)
  if (gameState === 'playing') {
    particles.forEach(p => p.update());
  }
  particles = particles.filter(p => !p.isDead());
  particles.forEach(p => p.draw());

  // Рисуем землю (останавливается при game over / skin select)
  if (gameState === 'playing') {
    drawGround();
  } else {
    drawStaticGround();
  }

  // Рисуем препятствия
  obstacles.forEach(obs => obs.draw());

  // Рисуем игрока (если не game over и не skin select)
  if (gameState === 'playing' || gameState === 'start') {
    player.draw();
  } else if (gameState === 'gameover') {
    // Рисуем игрока тусклым при проигрыше
    ctx.globalAlpha = 0.4;
    player.draw();
    ctx.globalAlpha = 1.0;
  }

  // Запрашиваем следующий кадр
  requestAnimationFrame(gameLoop);
}

// ========================
// Управление вводом
// ========================

/** Обработка нажатий клавиш */
document.addEventListener('keydown', (e) => {
  // Пробел — прыжок, старт, рестарт или выбор скина
  if (e.code === 'Space') {
    e.preventDefault(); // Предотвращаем скролл страницы

    // Первый запуск музыки при любом действии пользователя
    musicManager.init();

    if (gameState === 'start') {
      startScreen.classList.add('hidden');
      gameState = 'playing';
      player.jump();
      musicManager.playBackground();
    } else if (gameState === 'playing') {
      player.jump();
    } else if (gameState === 'gameover') {
      resetGame();
      player.jump();
    } else if (gameState === 'skinSelect') {
      // Применить выбранный скин и начать игру
      selectedSkin = currentSkin;
      localStorage.setItem('selectedSkin', selectedSkin);
      hideSkinSelect();
      gameState = 'playing';
      player.jump();
      musicManager.playBackground();
    }
  }

  // R — открыть выбор скина (из start или gameover)
  if (e.code === 'KeyR') {
    if (gameState === 'start' || gameState === 'gameover') {
      showSkinSelect();
    } else if (gameState === 'skinSelect') {
      // Если уже в выборе скина — закрыть и начать игру с текущим скином
      selectedSkin = currentSkin;
      localStorage.setItem('selectedSkin', selectedSkin);
      hideSkinSelect();
      musicManager.init();
      gameState = 'playing';
      player.jump();
      musicManager.playBackground();
    }
  }

  // Стрелки влево/вправо — навигация по скинам
  if (gameState === 'skinSelect') {
    if (e.code === 'ArrowLeft') {
      e.preventDefault();
      prevSkin();
    }
    if (e.code === 'ArrowRight') {
      e.preventDefault();
      nextSkin();
    }
  }

  // R — перезапуск после Game Over
  if (e.code === 'KeyR' && gameState === 'gameover') {
    musicManager.init();
    resetGame();
  }
});

/** Клик мышью — прыжок, старт или рестарт */
canvas.addEventListener('click', () => {
  // Первый запуск музыки при любом действии пользователя
  musicManager.init();

  if (gameState === 'start') {
    startScreen.classList.add('hidden');
    gameState = 'playing';
    player.jump();
    musicManager.playBackground();
  } else if (gameState === 'playing') {
    player.jump();
  } else if (gameState === 'gameover') {
    resetGame();
    player.jump();
  }
});

/** Кнопка переключения дня/ночи */
const dayNightBtn = document.getElementById('daynight-btn');
dayNightBtn.addEventListener('click', (e) => {
  e.stopPropagation(); // Не засчитывать как клик по canvas
  toggleDayNight();
});

/** Кнопка вкл/выкл музыки */
const musicToggleBtn = document.getElementById('music-toggle-btn');
musicToggleBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  musicManager.init(); // Инициализация при первом клике

  // Если музыка ещё не играет — запускаем её
  if (!musicManager.isPlaying) {
    musicManager.isMuted = false;
    localStorage.setItem('musicMuted', 'false');
    if (musicManager.audio) {
      musicManager.audio.muted = false;
    }
    musicManager.playBackground();
  } else {
    // Иначе переключаем mute/unmute
    musicManager.toggleMute();
  }
});

/** Кнопка следующего трека */
const musicNextBtn = document.getElementById('music-next-btn');
musicNextBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  musicManager.init(); // Инициализация при первом клике
  musicManager.nextTrack();
});

/** Кнопки выбора скина */
const skinPrevBtn = document.getElementById('skin-prev-btn');
const skinNextBtn = document.getElementById('skin-next-btn');

skinPrevBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  prevSkin();
});

skinNextBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  nextSkin();
});

// ========================
// Инициализация
// ========================

// Отображаем рекорд
saveHighScore();

// Устанавливаем начальную тему
gameContainer.classList.add('day');
updateDayNightBtn();

// Вызываем reset() игрока, чтобы он встал на пол с правильным размером скина
player.reset();

// Запускаем игровой цикл
gameLoop();
