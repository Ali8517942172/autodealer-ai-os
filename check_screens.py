import re, json, os

files = {
    'inventory': r'C:\Users\user\.gemini\antigravity-ide\brain\d83dad3d-d2b0-4910-bfc3-11ebf0af6537\.system_generated\steps\1152\output.txt',
    'finance': r'C:\Users\user\.gemini\antigravity-ide\brain\d83dad3d-d2b0-4910-bfc3-11ebf0af6537\.system_generated\steps\1154\output.txt',
    'automation': r'C:\Users\user\.gemini\antigravity-ide\brain\d83dad3d-d2b0-4910-bfc3-11ebf0af6537\.system_generated\steps\1156\output.txt',
}

for name, path in files.items():
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Find screen IDs
    screens = re.findall(r'"name":"projects/8873053041528864433/screens/([^"]+)"', content)
    print(f'{name}: screen_id = {screens[0] if screens else "NOT FOUND"}')
    
    # Find HTML content directly in output
    idx = content.find('<!DOCTYPE html>')
    if idx == -1:
        idx = content.find('<html')
    if idx >= 0:
        print(f'  HTML found at index {idx}, length {len(content) - idx}')
    else:
        print(f'  No HTML in output file')
