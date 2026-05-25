import json
import time

# Read the JS extraction script
with open('.claude/skills/browser-js-inject/extract_bilibili_favlist.js', 'r', encoding='utf-8') as f:
    js_code = f.read()

# Strip the outer function wrapper and invoke directly
# The script has: function main() { (async function() { ... })(); }
# We need to just run the async IIFE
clean_code = js_code.replace('function main(){', '').rstrip().rstrip('}')

# Inject and run
js(clean_code)

# Wait for async execution (up to 3 minutes for 17 pages)
print('Waiting for extraction to complete...')
urls = []
for i in range(180):
    time.sleep(1)
    try:
        result = js('return window.__bilibiliFavUrls || null;')
        if result and len(result) > 0:
            urls = result
            print(f'Found {len(urls)} urls so far...')
            # Continue waiting a bit to see if more come in
            if i > 30 and len(urls) >= 600:
                break
    except Exception as e:
        print(f'Poll error: {e}')
        pass

print(f'Final count: {len(urls)}')
with open('bilibili_urls.json', 'w', encoding='utf-8') as f:
    json.dump(urls, f, ensure_ascii=False, indent=2)

with open('bilibili_urls.txt', 'w', encoding='utf-8') as f:
    f.write('\n'.join(urls))

print('Results saved to bilibili_urls.json and bilibili_urls.txt')
