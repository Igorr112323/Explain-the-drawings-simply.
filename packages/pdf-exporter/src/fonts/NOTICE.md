# Шрифт PDF-инструкции

`packages/pdf-exporter/src/fonts/dejavu.ts` содержит подмножество **DejaVu Sans** (начертания Regular и
Bold) в base64 — оно нужно, чтобы `.pdf` показывал кириллицу, `Ø`, `±`, `°`, `×`, `№` и стрелки без
интернета и без шрифтов операционной системы.

- Источник: пакет `fonts-dejavu-core` (`/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf` и
  `DejaVuSans-Bold.ttf`).
- Пересборка: `python3 -m venv /tmp/fontenv && /tmp/fontenv/bin/pip install fonttools && /tmp/fontenv/bin/python scripts/build-pdf-fonts.py`.
- Подмножество: латиница, кириллица, типографика, математические символы и стрелки. Пропорциональные
  ширины глифов складываются в `metrics.ts` — по ним считается перенос строк.

## Лицензия

DejaVu Fonts License (производная от Bitstream Vera Fonts Copyright и Arev Fonts Copyright).

> Fonts are (c) Bitstream (see below). DejaVu changes are in public domain. Glyphs imported from Arev
> fonts are (c) Tavmjong Bah (see below).
>
> Bitstream Vera Fonts Copyright: Copyright (c) 2003 by Bitstream, Inc. All Rights Reserved. Bitstream
> Vera is a trademark of Bitstream, Inc. Permission is hereby granted, free of charge, to any person
> obtaining a copy of the fonts accompanying this license ("Fonts") and associated documentation files
> (the "Font Software"), to reproduce and distribute the Font Software, including without limitation the
> rights to use, copy, merge, publish, distribute, and/or sell copies of the Font Software, and to permit
> persons to whom the Font Software is furnished to do so, subject to the following conditions: The above
> copyright and this license notice shall be included in all copies of one or more of the Font Software
> typefaces. The Font Software may be modified, altered, or added to, and in particular the designs of
> glyphs or characters in the Fonts may be modified and additional glyphs or characters may be added to
> the Fonts, only if the fonts are renamed to names not containing either the words "Bitstream" or the
> word "Vera". This License becomes null and void to the extent applicable to Fonts or Font Software that
> has been modified and is distributed under the "Bitstream Vera" names. The Font Software may be sold as
> part of a larger software package but no copy of one or more of the Font Software typefaces may be sold
> by itself.
>
> Arev Fonts Copyright: Copyright (c) 2006 by Tavmjong Bah. All Rights Reserved. Permission is hereby
> granted, free of charge, to any person obtaining a copy of the fonts accompanying this license ("Fonts")
> and associated documentation files (the "Font Software"), to reproduce and distribute the modifications
> to the Bitstream Vera Font Software, including without limitation the rights to use, copy, merge,
> publish, distribute, and/or sell copies of the Font Software, and to permit persons to whom the Font
> Software is furnished to do so, subject to the following conditions: The above copyright and this
> license notice shall be included in all copies of one or more of the Font Software typefaces. The Font
> Software may be modified, altered, or added to, and in particular the designs of glyphs or characters
> in the Fonts may be modified and additional glyphs or characters may be added to the Fonts, only if the
> fonts are renamed to names not containing either the words "Tavmjong Bah" or the word "Arev". This
> License becomes null and void to the extent applicable to Fonts or Font Software that has been modified
> and is distributed under the "Arev" names. The Font Software may be sold as part of a larger software
> package but no copy of one or more of the Font Software typefaces may be sold by itself.
