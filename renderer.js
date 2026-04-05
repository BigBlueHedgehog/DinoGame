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
const finalScoreElement = document.getElementById('final-score');

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

let gameState = 'start'; // 'start' | 'playing' | 'gameover'
let score = 0;
let highScore = parseInt(localStorage.getItem('dinoHighScore')) || 0;
let gameSpeed = INITIAL_SPEED;
let frameCount = 0;        // Счётчик кадров для генерации препятствий
let isNight = false;
let lastObstacleY = 0;     // Для отслеживания последнего препятствия

// ========================
// Игрок (гусь — спрайт из duck.png)
// ========================

// Загружаем спрайт гуся (отражённый, без фона)
const duckSprite = new Image();
duckSprite.src = 'duck.png';

// Размеры спрайта
const DUCK_W = 151;
const DUCK_H = 202;
const DUCK_SCALE = 0.42; // Масштабирование для canvas
const DUCK_DRAW_W = DUCK_W * DUCK_SCALE;
const DUCK_DRAW_H = DUCK_H * DUCK_SCALE;

const player = {
  x: 80,                    // Позиция X (фиксирована)
  y: GROUND_Y - DUCK_DRAW_H - 4, // Позиция Y (подгоняем под размер спрайта)
  width: 66,                // Ширина хитбокса
  height: DUCK_DRAW_H + 4,  // Высота хитбокса
  velocityY: 0,
  isJumping: false,
  color: '#F5DEB3',         // Бежевый (для частиц)

  /** Сброс состояния игрока */
  reset() {
    this.y = GROUND_Y - DUCK_DRAW_H - 4;
    this.velocityY = 0;
    this.isJumping = false;
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
    if (this.y >= GROUND_Y - DUCK_DRAW_H - 4) {
      this.y = GROUND_Y - DUCK_DRAW_H - 4;
      this.velocityY = 0;
      this.isJumping = false;
    }
  },

  /** Отрисовка спрайта гуся */
  draw() {
    const isJump = this.isJumping;

    // Подпрыгивание при беге
    const bounce = isJump ? 0 : Math.sin(frameCount * 0.2) * 3;

    // Лёгкое покачивание клюва
    const beakWobble = isJump ? 0 : Math.sin(frameCount * 0.15) * 2;

    ctx.save();

    // Тень/свечение
    ctx.shadowColor = '#F5DEB3';
    ctx.shadowBlur = 8;

    // Позиция отрисовки
    const drawX = this.x + 2 + beakWobble;
    const drawY = this.y + bounce;

    // Рисуем спрайт
    if (duckSprite.complete && duckSprite.naturalWidth > 0) {
      ctx.drawImage(duckSprite, drawX, drawY, DUCK_DRAW_W, DUCK_DRAW_H);
    } else {
      // Фоллбэк: если спрайт ещё не загрузился — рисуем бежевый прямоугольник
      ctx.fillStyle = '#F5DEB3';
      ctx.fillRect(drawX, drawY, DUCK_DRAW_W, DUCK_DRAW_H);
    }

    ctx.shadowBlur = 0;
    ctx.restore();
  },

  /** Получить границы столкновения */
  getBounds() {
    const padding = 6;
    return {
      x: this.x + padding,
      y: this.y + padding,
      width: this.width - padding * 2,
      height: this.height - padding * 2,
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
      player.x + player.width / 2,
      player.y + player.height,
      '#F5DEB3'
    ));
  }
}

/** Частицы при столкновении */
function spawnCollisionParticles() {
  for (let i = 0; i < 20; i++) {
    particles.push(new Particle(
      player.x + player.width / 2,
      player.y + player.height / 2,
      '#e74c3c'
    ));
  }
}

/** Частицы "бег" (пыль из-под ног) */
function spawnRunParticles() {
  if (!player.isJumping && frameCount % 5 === 0) {
    particles.push(new Particle(
      player.x,
      player.y + player.height,
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
  }

  // Обновляем и рисуем частицы
  particles.forEach(p => p.update());
  particles = particles.filter(p => !p.isDead());
  particles.forEach(p => p.draw());

  // Рисуем землю (останавливается при game over)
  if (gameState !== 'gameover') {
    drawGround();
  } else {
    drawStaticGround();
  }

  // Рисуем препятствия
  obstacles.forEach(obs => obs.draw());

  // Рисуем игрока (если не game over)
  if (gameState !== 'gameover') {
    player.draw();
  } else {
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
  // Пробел — прыжок, старт или рестарт
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

// ========================
// Инициализация
// ========================

// Отображаем рекорд
saveHighScore();

// Устанавливаем начальную тему
gameContainer.classList.add('day');
updateDayNightBtn();

// Запускаем игровой цикл
gameLoop();
