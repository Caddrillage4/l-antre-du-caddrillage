#!/usr/bin/env python3
"""
Synchronisation & Export des écrits pour l'application autonome hors-ligne
Télécharge tous les écrits depuis Supabase et génère 'seed_writings.json'
afin qu'ils soient directement embarqués dans le .dmg et le .app lors de la compilation.
"""

import urllib.request
import json
import os
import sys

SUPABASE_URL = "https://thyiltzizyzlehxhhbjk.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRoeWlsdHppenl6bGVoeGhoYmprIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE4NzMyNDAsImV4cCI6MjEwNzQ0OTI0MH0._0HV4R35WKS9KnFnJJ5Khh5AeOLbARPOSIld_NdgUQ0"

def sync_seed():
    print("============================================================")
    print("  Export des écrits vers seed_writings.json")
    print("============================================================")
    
    script_dir = os.path.dirname(os.path.abspath(__file__))
    output_path = os.path.join(script_dir, "seed_writings.json")
    
    url = f"{SUPABASE_URL}/rest/v1/writings?select=*&order=created_at.desc"
    req = urllib.request.Request(url, headers={
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}"
    })
    
    try:
        print("1. Connexion à la base de données Supabase...")
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode())
            
        formatted = []
        for item in data:
            tags = item.get("tags") or []
            if isinstance(tags, str):
                try:
                    tags = json.loads(tags)
                except Exception:
                    tags = [t.strip() for t in tags.split(",") if t.strip()]
                    
            formatted.append({
                "id": str(item.get("id")),
                "title": item.get("title", ""),
                "category": item.get("category", ""),
                "summary": item.get("summary", ""),
                "poetryText": item.get("poetry_text") or (item.get("summary") if item.get("category") == "poesie" else "") or "",
                "tags": tags if isinstance(tags, list) else [],
                "displayDate": item.get("display_date", ""),
                "pageCount": item.get("page_count"),
                "wordCount": item.get("word_count"),
                "readingTime": item.get("reading_time", ""),
                "pdfUrl": item.get("pdf_url"),
                "pdfFileName": item.get("pdf_name"),
                "pdfFileSize": item.get("pdf_size"),
                "createdAt": item.get("created_at"),
                "updatedAt": item.get("updated_at")
            })
            
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(formatted, f, ensure_ascii=False, indent=2)
            
        print(f"✓ Succès : {len(formatted)} écrits enregistrés dans seed_writings.json.")
        print(f"  Fichier prêt à être embarqué dans le prochain .dmg macOS !")
        return 0
        
    except Exception as e:
        print(f"⚠️  Impossible de contacter Supabase ({e}).")
        if os.path.exists(output_path):
            print(f"ℹ️  Le fichier seed_writings.json existant sera conservé.")
        else:
            print("ℹ️  Aucun fichier seed_writings.json précédent trouvé.")
        return 1

if __name__ == "__main__":
    sys.exit(sync_seed())
