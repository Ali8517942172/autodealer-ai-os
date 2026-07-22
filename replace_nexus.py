import os
import re

def replace_in_file(filepath):
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception as e:
        return False

    original = content
    # Replace cases
    content = re.sub(r'\bNEXUS\b', 'NEXUS OS', content)
    content = re.sub(r'\bnexus\b', 'Nexus', content)
    content = re.sub(r'\bNexus\b', 'Nexus', content)
    
    # Also catch joined words like nexus-os-marketing -> nexus-os-marketing
    content = re.sub(r'Nexus-', 'Nexus-', content)
    content = re.sub(r'NEXUS OS-', 'NEXUS OS-', content)
    content = re.sub(r'-Nexus', '-Nexus', content)
    
    # Catch "NEXUS OS Cars" -> "NEXUS OS AI"
    content = re.sub(r'NEXUS OS Cars', 'NEXUS OS', content)
    content = re.sub(r'Nexus cars', 'Nexus', content)

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
        if '__pycache__' in dirs:
            dirs.remove('__pycache__')

        for file in files:
            if file.endswith(('.js', '.json', '.md', '.html', '.css', '.yaml', '.yml', '.py', '.jsx')):
                filepath = os.path.join(root, file)
                if replace_in_file(filepath):
                    count += 1
                    print(f"Updated: {filepath}")
    print(f"Total files updated: {count}")

process_directory(r"C:\Users\user\Desktop\MY RESUMES\Nexus-ai-platform")
