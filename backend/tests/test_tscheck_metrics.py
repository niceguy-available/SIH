def test_registration_exposes_evaluation_metrics(client):
    response = client.post(
        '/registration/run',
        files={'source_image': ('tscheck-metrics.jpg', b'metrics-image', 'image/jpeg')},
    )
    assert response.status_code == 200, response.text[:300]
    metrics = response.json()['metrics']
    assert metrics['rmse'] >= 0
    assert metrics['inlier_count'] == 24
    assert metrics['total_matches'] == 24
    assert metrics['inlier_ratio'] == 1.0
    assert metrics['subpixel_accuracy'] >= 0
