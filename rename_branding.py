import os

root_dir = r"C:\Users\user\Desktop\MY RESUMES\nexus-os"
exclude_dirs = {'.git', 'node_modules', '.next', 'build', '__pycache__', 'venv', '.env', '.venv', '.gemini'}

# Be careful with order, replace longer strings first to avoid partial replacements
ordered_replacements = [
    ("NEXUS OS", "NEXUS OS"),
    ("NEXUS OS", "NEXUS OS"),
    ("nexus os", "nexus os"),
    ("nexus-os", "nexus-os"),
    ("nexus-os", "nexus-os"),
    ("NEXUS OS", "NEXUS OS"),
    ("NEXUS", "NEXUS"),
    ("nexus", "nexus")
]

def process_file(filepath):
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
    except UnicodeDecodeError:
        # Skip binary files or non-utf8
        return
    except Exception as e:
        print(f"Error reading {filepath}: {e}")
        return

    new_content = content
    for old_str, new_str in ordered_replacements:
        new_content = new_content.replace(old_str, new_str)
        
    if new_content != content:
        try:
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(new_content)
            print(f"Updated: {filepath}")
        except Exception as e:
            print(f"Error writing {filepath}: {e}")

for dirpath, dirnames, filenames in os.walk(root_dir):
    # Skip excluded directories
    dirnames[:] = [d for d in dirnames if d not in exclude_dirs]
    
    for filename in filenames:
        if filename.endswith(('.pyc', '.png', '.jpg', '.jpeg', '.gif', '.mp4', '.pdf', '.zip', '.tar', '.gz')):
            continue # skip media
        
        filepath = os.path.join(dirpath, filename)
        process_file(filepath)

print("Renaming complete.")
