import os

steps = {
    'inventory': r"C:\Users\user\.gemini\antigravity-ide\brain\d83dad3d-d2b0-4910-bfc3-11ebf0af6537\.system_generated\steps\1190\content.md",
    'finance': r"C:\Users\user\.gemini\antigravity-ide\brain\d83dad3d-d2b0-4910-bfc3-11ebf0af6537\.system_generated\steps\1194\content.md",
    'automation': r"C:\Users\user\.gemini\antigravity-ide\brain\d83dad3d-d2b0-4910-bfc3-11ebf0af6537\.system_generated\steps\1199\content.md",
}

out_dir = r"C:\Users\user\Desktop\MY RESUMES\nexus-os\apps\executive-dashboard\public"

for name, path in steps.items():
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Extract from <!DOCTYPE html> onwards
    idx = content.find('<!DOCTYPE html>')
    if idx == -1:
        idx = content.find('<html')
    
    if idx >= 0:
        html = content[idx:]
        out_path = os.path.join(out_dir, f'stitch-{name}.html')
        with open(out_path, 'w', encoding='utf-8') as f:
            f.write(html)
        print(f"Saved: stitch-{name}.html ({len(html)} bytes)")
    else:
        print(f"WARNING: No HTML found in {name}")
