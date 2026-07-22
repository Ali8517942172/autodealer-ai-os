import re, os

files = {
    'inventory': r'C:\Users\user\.gemini\antigravity-ide\brain\d83dad3d-d2b0-4910-bfc3-11ebf0af6537\.system_generated\steps\1152\output.txt',
    'finance': r'C:\Users\user\.gemini\antigravity-ide\brain\d83dad3d-d2b0-4910-bfc3-11ebf0af6537\.system_generated\steps\1154\output.txt',
    'automation': r'C:\Users\user\.gemini\antigravity-ide\brain\d83dad3d-d2b0-4910-bfc3-11ebf0af6537\.system_generated\steps\1156\output.txt',
}

out_dir = r"C:\Users\user\Desktop\MY RESUMES\nexus-os\apps\executive-dashboard\public"

for name, path in files.items():
    try:
        with open(path, 'r', encoding='utf-8') as f:
            content = f.read()
    except FileNotFoundError:
        print(f"File not found: {path}")
        continue
    
    # Extract from <!DOCTYPE html> onwards
    idx = content.find('<!DOCTYPE html>')
    if idx == -1:
        idx = content.find('<html')
    
    if idx >= 0:
        html = content[idx:]
        
        # There might be a JSON closing quote at the end of the HTML because it's extracted from JSON output.
        # Let's clean it up by finding the closing </html>
        end_idx = html.find('</html>')
        if end_idx >= 0:
            html = html[:end_idx + 7]
            
        out_path = os.path.join(out_dir, f'stitch-{name}.html')
        with open(out_path, 'w', encoding='utf-8') as f:
            f.write(html)
        print(f"Saved: stitch-{name}.html ({len(html)} bytes)")
    else:
        print(f"WARNING: No HTML found in {name}")
