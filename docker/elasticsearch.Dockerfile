# Elasticsearch 8.13.4 + IK analyzer for CJK tokenization.
# IK version must match ES version exactly — this pair is tested.
FROM docker.elastic.co/elasticsearch/elasticsearch:8.13.4

RUN bin/elasticsearch-plugin install --batch \
    https://release.infinilabs.com/analysis-ik/stable/elasticsearch-analysis-ik-8.13.4.zip
