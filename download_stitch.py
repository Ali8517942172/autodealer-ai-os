import re, os, urllib.request

files = {
    'inventory': r'C:\Users\user\.gemini\antigravity-ide\brain\d83dad3d-d2b0-4910-bfc3-11ebf0af6537\.system_generated\steps\1152\output.txt',
    'finance': r'C:\Users\user\.gemini\antigravity-ide\brain\d83dad3d-d2b0-4910-bfc3-11ebf0af6537\.system_generated\steps\1154\output.txt',
    'automation': r'C:\Users\user\.gemini\antigravity-ide\brain\d83dad3d-d2b0-4910-bfc3-11ebf0af6537\.system_generated\steps\1156\output.txt',
}

out_dir = r'C:\Users\user\Desktop\MY RESUMES\nexus-os\apps\executive-dashboard\public'

for name, path in files.items():
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Find download URL
    urls = re.findall(r'https://contribution\.usercontent\.google\.com/download\?[^"\\s]+', content)
    if not urls:
        print(f'{name}: NO URL FOUND')
        continue
    
    url = urls[0].replace('\\u0026', '&')
    print(f'{name}: Downloading from {url[:60]}...')
    
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=15) as resp:
            html = resp.read().decode('utf-8')
        
        # Check if light mode
        is_light = 'class="light"' in html or "background: #faf" in html or "bg-white" in html
        print(f'  Light mode: {is_light}')
        
        out_path = os.path.join(out_dir, f'stitch-{name}.html')
        with open(out_path, 'w', encoding='utf-8') as f:
            f.write(html)
        print(f'  Saved: stitch-{name}.html ({len(html)} bytes)')
    except Exception as e:
        print(f'  ERROR: {e}')
