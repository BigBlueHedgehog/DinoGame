#!/usr/bin/env python3
"""
Генератор иконки для Dino Runner
Создаёт простую PNG-иконку 256x256 с пиксельным динозавром
"""

from PIL import Image

def create_icon():
    size = 256
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    pixels = img.load()

    # Цвета
    orange = (243, 156, 18, 255)    # f39c12
    dark = (44, 62, 80, 255)        # 2c3e50
    white = (255, 255, 255, 255)

    # Рисуем пиксельного динозавра (упрощённый спрайт)
    # Формат: (x, y) — верхний левый угол каждого блока 16x16
    pixel_size = 16
    offset_x = 32
    offset_y = 48

    # Тело динозавра (сетка 10x8)
    body_pixels = [
        # Голова
        (6, 0), (7, 0), (8, 0), (9, 0),
        (6, 1), (7, 1), (8, 1), (9, 1),
        (5, 2), (6, 2), (7, 2), (8, 2), (9, 2),
        (5, 3), (6, 3), (7, 3), (8, 3), (9, 3),
        # Глаз (белый)
        # (8, 1) будет белым — нарисуем отдельно
        
        # Шея и тело
        (3, 4), (4, 4), (5, 4), (6, 4), (7, 4), (8, 4),
        (2, 5), (3, 5), (4, 5), (5, 5), (6, 5), (7, 5), (8, 5),
        (2, 6), (3, 6), (4, 6), (5, 6), (6, 6), (7, 6), (8, 6),
        
        # Хвост
        (0, 5), (1, 5),
        (0, 6), (1, 6),
        
        # Ноги
        (3, 7), (4, 7),
        (6, 7), (7, 7),
        (3, 8), (4, 8),
        (6, 8), (7, 8),
    ]

    # Рисуем тело
    for (gx, gy) in body_pixels:
        x = offset_x + gx * pixel_size
        y = offset_y + gy * pixel_size
        for px in range(x, x + pixel_size):
            for py in range(y, y + pixel_size):
                if 0 <= px < size and 0 <= py < size:
                    pixels[px, py] = orange

    # Глаз (белый квадрат)
    eye_x = offset_x + 8 * pixel_size
    eye_y = offset_y + 1 * pixel_size
    for px in range(eye_x, eye_x + pixel_size):
        for py in range(eye_y, eye_y + pixel_size):
            if 0 <= px < size and 0 <= py < size:
                pixels[px, py] = white

    # Земля (линия внизу)
    ground_y = offset_y + 9 * pixel_size
    for px in range(16, size - 16):
        for py in range(ground_y, ground_y + 8):
            if 0 <= px < size and 0 <= py < size:
                pixels[px, py] = dark

    # Сохраняем
    output_path = '/home/yulyak/VSCodeProjects/dinosour_game/assets/icon.png'
    img.save(output_path, 'PNG')
    print(f'Иконка сохранена: {output_path}')

if __name__ == '__main__':
    create_icon()
