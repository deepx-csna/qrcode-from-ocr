cmake_minimum_required(VERSION 3.14)
project(serial_ocr_server DESCRIPTION "DEEPX Serial-QR demo server (PP-OCRv6 + MJPEG)")

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(OpenCV REQUIRED)

if(CROSS_COMPILE OR MSVC)
    find_library(DXRT_LIB dxrt HINTS ${DXRT_INSTALLED_DIR}/lib REQUIRED)
    include_directories(${DXRT_INSTALLED_DIR}/include)
    link_directories(${DXRT_INSTALLED_DIR}/lib)
else()
    find_package(dxrt REQUIRED HINTS ${DXRT_INSTALLED_DIR})
    set(DXRT_LIB dxrt)
endif()

get_filename_component(APP_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/.." ABSOLUTE)

add_executable(serial_ocr_server
    serial_ocr_server.cpp
    device_registry.cpp
    ocr_engine.cpp
)

# 실행 파일이 어디서 실행되든 모델/웹/데이터를 찾을 수 있도록 저장소 루트를 박아 둔다.
target_compile_definitions(serial_ocr_server PRIVATE
    APP_ROOT_DIR="${APP_ROOT}"
)

target_include_directories(serial_ocr_server PRIVATE
    ${OpenCV_INCLUDE_DIRS}
    ${CMAKE_CURRENT_SOURCE_DIR}
    ${CMAKE_CURRENT_SOURCE_DIR}/third_party
)

target_compile_options(serial_ocr_server PRIVATE -Wall -Wextra -O3)

find_package(Threads REQUIRED)

target_link_libraries(serial_ocr_server PRIVATE
    ${OpenCV_LIBS}
    ${DXRT_LIB}
    Threads::Threads
)
