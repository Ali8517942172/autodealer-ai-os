import re
files = {
    'finance': r'C:\Users\user\.gemini\antigravity-ide\brain\d83dad3d-d2b0-4910-bfc3-11ebf0af6537\.system_generated\steps\1154\output.txt',
    'automation': r'C:\Users\user\.gemini\antigravity-ide\brain\d83dad3d-d2b0-4910-bfc3-11ebf0af6537\.system_generated\steps\1156\output.txt',
}
for name, path in files.items():
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    urls = re.findall(r'https://contribution\.usercontent\.google\.com/download\?[^\s\"]+', content)
    print(f'{name}_url={urls[0]}')
