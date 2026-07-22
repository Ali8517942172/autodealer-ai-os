import os
import re

def replace_in_file(filepath):
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception as e:
        return False

    original = content
    
    # Fix the weird hyphenated names
    content = re.sub(r'nexus-os', 'nexus-os', content)
    content = re.sub(r'nexus-os-marketing', 'nexus-os-marketing', content)
    
    # Fix UI text inconsistencies
    content = re.sub(r'NEXUS OS', 'NEXUS OS', content)
    
    if content != original:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        return True
    return False

def process_directory(directory):
    count = 0
    for root, dirs, files in os.walk(directory):
        if 'node_modules' in dirs:
            dirs.remove('node_modules')
        if 'venv' in dirs:
            dirs.remove('venv')
        if '.git' in dirs:
            dirs.remove('.git')

        for file in files:
            if file.endswith(('.js', '.json', '.md', '.html', '.css', '.yaml', '.yml', '.py', '.jsx')):
                filepath = os.path.join(root, file)
                if replace_in_file(filepath):
                    count += 1
                    print(f"Updated: {filepath}")
    print(f"Total files updated: {count}")

process_directory(r"C:\Users\user\Desktop\MY RESUMES\nexus-os")
