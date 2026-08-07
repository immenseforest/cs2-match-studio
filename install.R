required <- c("shiny", "bslib", "data.table", "jsonlite", "plotly", "DT")
missing <- setdiff(required, rownames(installed.packages()))
if (length(missing)) install.packages(missing, repos="https://cloud.r-project.org")
cat("R dependencies are ready.\n")
cat("Install Python dependencies with: python -m pip install -r requirements.txt\n")

