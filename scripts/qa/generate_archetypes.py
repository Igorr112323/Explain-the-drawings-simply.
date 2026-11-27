#!/usr/bin/env python3
"""Three synthetic engineering archetypes; not a substitute for real annotated drawings."""
from __future__ import annotations
import argparse, json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont


def generate(out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    fontpath = Path('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')
    if not fontpath.exists(): fontpath = Path('C:/Windows/Fonts/arial.ttf')
    if not fontpath.exists(): raise RuntimeError('A Cyrillic font is required')
    f = ImageFont.truetype(str(fontpath), 34)
    small = ImageFont.truetype(str(fontpath), 27)
    items = []
    def canvas():
        im = Image.new('RGB', (2400, 1600), 'white'); d = ImageDraw.Draw(im)
        d.rectangle((35, 35, 2365, 1565), outline='black', width=4)
        return im, d
    im, d = canvas()
    d.text((70, 65), 'ЖАРОВНЯ   СБОРОЧНЫЙ ЧЕРТЁЖ', font=f, fill='black')
    for x, name in [(140,'Спереди'),(820,'Сбоку'),(1500,'Сверху')]:
        d.rectangle((x,220,x+470,620),outline='black',width=4); d.text((x,650),name,font=f,fill='black')
    d.text((150,740), '600                170                 Ø16', font=f, fill='black')
    d.text((100,830),'ПОЗИЦИЯ   ОБОЗНАЧЕНИЕ       ОПИСАНИЕ                         К-ВО',font=small,fill='black')
    for i, text in enumerate(['1   Спереди м        Толщина стенок 4мм          1','2   Сбоку                 Боковая стенка                  2','3   Сверху                Верхняя стенка                   1','4   Корпус                 Основание                          1','5   Ручка жаровни   Ручка                                   2']):
        d.text((100,880+i*48),text,font=small,fill='black')
    d.rectangle((1500,1210,2300,1510),outline='black',width=4)
    for i,text in enumerate(['Жаровня','Сталь 4 мм','Масса 16.34','Масштаб 1:5']): d.text((1530,1230+i*52),text,font=small,fill='black')
    d.text((1550,1400),'ОБРАЗЕЦ',font=f,fill=(205,205,205))
    im.save(out/'archetype_a.png'); items.append({'file':'archetype_a.png','words':['Жаровня','Сталь','Спереди','Сбоку','Сверху'],'dimensions':['600','170','16']})
    im,d=canvas(); d.text((80,70),'МАМИ 019.046     ДЕТАЛЬ № 46',font=f,fill='black')
    for x in [150,850,1550]:
        d.rectangle((x,230,x+480,700),outline='black',width=5)
        for k in range(12): d.line((x+10+k*35,690,x+200+k*20,250),fill=(70,70,70),width=2)
    d.text((100,770),'80     40     56     15     24      Ø110    Ø45    Ø90    Ø62',font=f,fill='black')
    d.text((110,840),'4 отв. Ø10       45°',font=f,fill='black')
    d.rectangle((1500,1200,2300,1500),outline='black',width=4)
    for i,text in enumerate(['МАМИ 019.046','Деталь № 46','Сталь','1:1']): d.text((1530,1220+i*55),text,font=f,fill='black')
    im.save(out/'archetype_b.png'); items.append({'file':'archetype_b.png','words':['Деталь','Сталь','МАМИ'],'dimensions':['80','40','56','15','24','110','45','90','62','10']})
    im,d=canvas();d.text((80,70),'КАРКАС БЕСЕДКИ',font=f,fill='black')
    for x in [300,800,1300,1800]: d.line((x,850,x,350),fill='#815c37',width=16)
    d.line((250,850,1900,850),fill='#815c37',width=20);d.line((250,350,1900,350),fill='#815c37',width=20)
    d.line((250,350,1000,140),fill='#2e6590',width=18);d.line((1000,140,1900,350),fill='#2e6590',width=18)
    for i,text in enumerate(['Нижняя обвязка','Верхняя обвязка','Опора 80×80 мм','Стропило','2500    2100    900','Узел I','Узел II','Рис. 2. Соединение стропила с рамой','Рис. 3. Крепление стропил к опоре']):
        d.text((100,930+i*58),text,font=small,fill='black')
    im.save(out/'archetype_c.png');items.append({'file':'archetype_c.png','words':['Нижняя','Верхняя','Опора','Стропило','Узел'],'dimensions':['80','2500','2100','900']})
    (out/'ground_truth.json').write_text(json.dumps(items,ensure_ascii=False,indent=2),encoding='utf-8')

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--out',type=Path,default=Path('qa/archetypes'));generate(parser.parse_args().out)
