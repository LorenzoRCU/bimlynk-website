@echo off
REM Deploy BIM LYNK website to Netlify
REM Usage: deploy.bat "commit message"

cd /d "%~dp0"

if "%~1"=="" (
    set COMMIT_MSG=chore: update site
) else (
    set COMMIT_MSG=%~1
)

echo ========================================
echo   BIM LYNK — Deploy to Netlify
echo ========================================
echo.

echo [1/3] Committing changes...
git add -A
git diff --cached --quiet
if %ERRORLEVEL% EQU 0 (
    echo No changes to commit.
) else (
    git commit -m "%COMMIT_MSG%"
    echo [2/3] Pushing to GitHub...
    git push origin HEAD
)

echo.
echo [3/3] Deploying to Netlify...
netlify deploy --prod --dir=.

echo.
echo ========================================
echo   Done! Site is live at bimlynk.com
echo ========================================
pause
