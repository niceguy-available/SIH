IMAGE_BYTES = b'not-empty-demo-image'


def test_registration_accepts_source_and_returns_24_matches(client):
    response = client.post(
        '/registration/run',
        files={'source_image': ('tscheck-registration.png', IMAGE_BYTES, 'image/png')},
        data={'reference_id': 'lroc-nac-north-pole', 'refine': 'true', 'rotation': '1.5', 'scale': '1.01'},
    )
    assert response.status_code == 200, response.text[:300]
    payload = response.json()
    assert payload['source_filename'] == 'tscheck-registration.png'
    assert payload['reference']['id'] == 'lroc-nac-north-pole'
    assert len(payload['match_points']) == 24
    assert payload['product_status'] == 'DEMO / EVALUATION MODE'


def test_registration_rejects_unsupported_file_type(client):
    response = client.post(
        '/registration/run',
        files={'source_image': ('tscheck-registration.txt', IMAGE_BYTES, 'text/plain')},
    )
    assert response.status_code == 415
