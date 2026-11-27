"""Smoke-test the packaged Windows executable from a Unicode path, not the source service."""
from __future__ import annotations
import io, json, os, shutil, socket, subprocess, sys, tempfile, time, urllib.request
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

source = Path(sys.argv[1]).resolve()
with tempfile.TemporaryDirectory(prefix='IKGuide Проверка ') as tmp:
    root = Path(tmp) / 'Движок с пробелом'
    shutil.copytree(source, root)
    exe = root / 'ikguide-vision.exe'
    assert exe.is_file() and (root / 'vision-engine' / 'tesseract.exe').is_file()
    assert (root / 'vision-engine' / 'tessdata' / 'rus.traineddata').is_file()
    assert (root / 'vision-engine' / 'tessdata' / 'eng.traineddata').is_file()
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0)); port = sock.getsockname()[1]
    env = dict(os.environ, VISION_PORT=str(port))
    env.pop('TESSDATA_PREFIX', None)
    env.pop('IKGUIDE_TESSERACT', None)
    engine_log = tempfile.TemporaryFile(mode='w+b')
    process = subprocess.Popen([str(exe)], cwd=root, env=env, stdin=subprocess.DEVNULL,
                               stdout=engine_log, stderr=engine_log,
                               creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    try:
        base = f'http://127.0.0.1:{port}'
        for _ in range(90):
            if process.poll() is not None: raise RuntimeError(f'engine exited: {process.returncode}')
            try:
                with urllib.request.urlopen(base + '/health', timeout=2) as r: health = json.load(r)
                break
            except Exception: time.sleep(1)
        else: raise RuntimeError('engine health timeout')
        assert health['service'] == 'ikguide-vision-api' and 'tesseract-rus-eng' in health['ocr'], health
        image = Image.new('RGB', (1800, 1200), 'white'); draw = ImageDraw.Draw(image)
        font = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 64)
        draw.rectangle((80, 80, 1720, 1120), outline='black', width=5)
        draw.rectangle((950, 700, 1720, 1120), outline='black', width=4)
        for y, text in [(740, 'Деталь № 46'), (830, 'Сталь'), (920, '4 отв. Ø10')]:
            draw.text((990, y), text, font=font, fill='black')
        buf = io.BytesIO(); image.save(buf, format='PNG'); data = buf.getvalue()
        boundary = '----ikguide-smoke'
        payload = (f'--{boundary}\r\nContent-Disposition: form-data; name="files"; filename="drawing.png"\r\nContent-Type: image/png\r\n\r\n'.encode() + data + f'\r\n--{boundary}--\r\n'.encode())
        request = urllib.request.Request(base + '/v1/recognize', payload, {'Content-Type': f'multipart/form-data; boundary={boundary}'})
        with urllib.request.urlopen(request, timeout=180) as r: result = json.load(r)
        content = json.dumps({'titleBlock': result.get('titleBlock'), 'candidates': result.get('candidates')}, ensure_ascii=False).lower()
        assert 'сталь' in content, content[:10000]
        assert 'деталь' in content, content[:10000]
        assert '46' in content and '10' in content, content[:10000]
        print('Windows packaged OCR smoke passed:', health['ocr'])
    except Exception:
        engine_log.flush()
        engine_log.seek(0)
        print('Engine log:', engine_log.read().decode('utf-8', errors='replace')[-12000:])
        raise
    finally:
        # Kill the PyInstaller process tree too: Tesseract subprocesses may otherwise retain
        # files and prevent cleanup or keep the Actions log pipe open.
        if os.name == 'nt' and process.poll() is None:
            subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20, check=False)
        elif process.poll() is None:
            process.terminate()
        try: process.wait(timeout=15)
        except subprocess.TimeoutExpired: process.kill(); process.wait(timeout=10)
        engine_log.close()
