.PHONY: test build screenshots

# Compile and run the tests
test:
	npm test

# Run the tests, then package the extension into build/
build: test
	npm run package

# Retake the README images in images/ (needs build/ and takes over mouse and keyboard for about a minute)
screenshots:
	powershell -ExecutionPolicy Bypass -File scripts/screenshots/take.ps1
